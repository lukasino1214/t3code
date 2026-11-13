import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type ProviderInteractionMode,
  type ServerProvider,
} from "@t3tools/contracts";

export function resolveProviderInteractionMode(
  provider: Pick<ServerProvider, "showInteractionModeToggle"> | null | undefined,
  interactionMode: ProviderInteractionMode | null | undefined,
): ProviderInteractionMode {
  return provider?.showInteractionModeToggle === false
    ? DEFAULT_PROVIDER_INTERACTION_MODE
    : (interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE);
}
