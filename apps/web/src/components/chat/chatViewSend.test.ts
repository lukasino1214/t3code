import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { deriveProviderInstanceEntries } from "../../providerInstances";
import { resolveMultipleModelTargets } from "./chatViewSend";

it.each(["plan", "default"] as const)(
  "resolves %s mode independently for each provider in a multiple-model send",
  (interactionMode) => {
    const providers = [true, false].map((supported): ServerProvider => ({
      instanceId: ProviderInstanceId.make(supported ? "supports-plan" : "build-only"),
      driver: ProviderDriverKind.make("codex"),
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-11-01T00:00:00.000Z",
      models: [],
      slashCommands: [],
      skills: [],
      showInteractionModeToggle: supported,
    }));
    const targets = resolveMultipleModelTargets({
      selections: providers.map(({ instanceId }) => ({ instanceId, model: "gpt-5.4" })),
      providerInstanceEntries: deriveProviderInstanceEntries(providers),
      messageText: "Investigate the change",
      interactionMode,
    });
    expect(
      targets.map((target) => ("error" in target ? target.error : target.interactionMode)),
    ).toEqual([interactionMode, "default"]);
  },
);
