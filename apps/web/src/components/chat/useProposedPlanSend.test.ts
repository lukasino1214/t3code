import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { PlanId, ProviderDriverKind, type ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  commands: new Map<unknown, ReturnType<typeof vi.fn>>(),
  navigate: vi.fn(),
}));

vi.mock("../../state/use-orchestration-command", () => ({
  useOrchestrationCommand: (command: unknown) => mocks.commands.get(command),
}));
vi.mock(import("../../state/session"), async (original) => ({
  ...(await original()),
  readEnvironmentScope: () => true,
}));
vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useNavigate: () => mocks.navigate,
}));
vi.mock(import("../../composerDraftStore"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    useComposerDraftStore: Object.assign(
      (selector: Parameters<typeof actual.useComposerDraftStore>[0]) =>
        selector(actual.useComposerDraftStore.getState()),
      actual.useComposerDraftStore,
    ) as typeof actual.useComposerDraftStore,
  };
});

import { useComposerDraftStore } from "../../composerDraftStore";
import type { ComposerHandleRef } from "../../composerHandleContext";
import { threadEnvironment } from "../../state/threads";
import { makeThreadFixture } from "../../test-fixtures";
import type { ChatComposerHandle } from "./ChatComposer";
import { draftSendState } from "./chatViewSend";
import { useImplementPlanInNewThread, usePlanFollowUpSend } from "./useProposedPlanSend";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function setup() {
  const start = vi.fn().mockResolvedValue(AsyncResult.success(undefined));
  const create = vi.fn().mockResolvedValue(AsyncResult.success(undefined));
  const remove = vi.fn().mockResolvedValue(AsyncResult.success(undefined));
  mocks.commands = new Map<unknown, ReturnType<typeof vi.fn>>([
    [threadEnvironment.startTurn, start],
    [threadEnvironment.create, create],
    [threadEnvironment.delete, remove],
  ]);
  mocks.navigate.mockReset().mockResolvedValue(undefined);
  const thread = makeThreadFixture({ interactionMode: "plan" });
  const ref = scopeThreadRef(thread.environmentId, thread.id);
  useComposerDraftStore.getState().setInteractionMode(ref, "plan");
  const routeThreadKey = "plan-send-test";
  draftSendState(routeThreadKey).sendInFlight.current = false;
  const composerRef: ComposerHandleRef = {
    current: {
      getSendContext: () => ({
        answeringPendingUserInput: false,
        prompt: "",
        images: [],
        files: [],
        terminalContexts: [],
        previewAnnotations: [],
        reviewComments: [],
        threadContexts: [],
        environmentContexts: [],
        multipleModelSelections: null,
        shownPendingApprovalIds: [],
        providerAvailable: true,
        interactionModeEnabled: true,
        interactionMode: "plan",
        selectedProvider: ProviderDriverKind.make("codex"),
        selectedModel: thread.modelSelection.model,
        selectedModelSelection: thread.modelSelection,
        selectedProviderModels: [],
        selectedPromptEffort: null,
      }),
    } as unknown as ChatComposerHandle,
  };
  const input = {
    environmentId: thread.environmentId,
    routeThreadKey,
    activeThread: thread,
    activeThreadBranch: "main",
    activeProposedPlan: {
      id: PlanId.make("ready-plan"),
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
      runId: null,
      planMarkdown: "# Ship it\n\nImplement the feature.",
      status: "active" as const,
    },
    isServerThread: true,
    isSendBusy: false,
    composerRef,
    beginLocalDispatch: vi.fn(),
    resetLocalDispatch: vi.fn(),
    runtimeMode: "full-access" as const,
    localCheckoutBranchMismatch: null,
    setOptimisticUserMessages: vi.fn(),
    setThreadError: vi.fn(),
    anchorNewTurn: vi.fn(),
    persistThreadSettingsForNextTurn: vi.fn().mockResolvedValue(AsyncResult.success(undefined)),
  } satisfies Parameters<typeof usePlanFollowUpSend>[0];
  return { input, ref, start, create, remove };
}

it.each(["plan", "default"] as const)(
  "links implementation to its source plan only when leaving planning (%s)",
  async (interactionMode) => {
    const { input, ref, start } = setup();
    expect(await usePlanFollowUpSend(input)({ text: "Continue", interactionMode })).toBe(true);
    const request = start.mock.calls[0]?.[0] as { input: Record<string, unknown> };
    expect(request.input.interactionMode).toBe(interactionMode);
    expect(request.input.sourceProposedPlan).toEqual(
      interactionMode === "default"
        ? { threadId: ref.threadId, planId: input.activeProposedPlan.id }
        : undefined,
    );
    expect(useComposerDraftStore.getState().getComposerDraft(ref)?.interactionMode).toBe(
      interactionMode,
    );
  },
);

it("keeps a failed implementation retryable and prevents duplicate sends while it is in flight", async () => {
  const { input, ref, start } = setup();
  const started = deferred<void>();
  const reply = deferred<AtomCommandResult<void, unknown>>();
  start.mockImplementation(() => {
    started.resolve();
    return reply.promise;
  });
  const submit = usePlanFollowUpSend(input);
  const pending = submit({ text: "Implement the plan", interactionMode: "default" });
  await started.promise;
  expect(useComposerDraftStore.getState().getComposerDraft(ref)?.interactionMode).toBe("default");
  expect(await submit({ text: "Implement again", interactionMode: "default" })).toBe(false);
  reply.resolve(AsyncResult.failure(Cause.fail(new Error("Connection lost"))));
  expect(await pending).toBe(false);
  expect(start).toHaveBeenCalledOnce();
  expect(useComposerDraftStore.getState().getComposerDraft(ref)?.interactionMode).toBe("plan");
});

it.each(["start", "navigation", "none"] as const)(
  "cleans up an implementation thread only if its turn failed to start (%s)",
  async (failure) => {
    const { input, ref, start, create, remove } = setup();
    if (failure === "start") {
      start.mockResolvedValue(AsyncResult.failure(Cause.fail(new Error("Connection lost"))));
    }
    if (failure === "navigation") mocks.navigate.mockRejectedValue(new Error("Navigation failed"));
    await useImplementPlanInNewThread({
      ...input,
      activeProject: { id: input.activeThread.projectId } as EnvironmentProject,
      activeEnvironmentUnavailable: false,
      defaultRuntimeMode: "full-access",
    })();
    const created = create.mock.calls[0]?.[0] as { input: { threadId: ThreadId } };
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          threadId: created.input.threadId,
          interactionMode: "default",
          sourceProposedPlan: { threadId: ref.threadId, planId: input.activeProposedPlan.id },
        }),
      }),
    );
    if (failure === "start") {
      expect(remove).toHaveBeenCalledExactlyOnceWith({
        environmentId: ref.environmentId,
        input: { threadId: created.input.threadId },
      });
    } else {
      expect(remove).not.toHaveBeenCalled();
    }
    expect(useComposerDraftStore.getState().getComposerDraft(ref)?.interactionMode).toBe("plan");
  },
);
