/** Only migrate the former design-review default, preserving other bindings. */
export function shouldUpgradeDesignReviewExpert(stageKey: string, currentId: string | undefined, requestedId: unknown): boolean {
  return stageKey === 'stage:设计评审'
    && currentId === 'product-design--product-management'
    && requestedId === 'team-ui--ui-frontend-expert';
}
