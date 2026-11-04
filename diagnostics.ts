export interface ConnectionDetails {
  label: string;
  localType?: string;
  remoteType?: string;
  protocol?: string;
  roundTripMs?: number;
}

export function selectedRoute(stats: RTCStatsReport): ConnectionDetails {
  for (const report of stats.values()) {
    if (report.type !== 'transport' || !report.selectedCandidatePairId) continue;
    const pair = stats.get(report.selectedCandidatePairId);
    if (!pair) continue;
    const local = stats.get(pair.localCandidateId);
    const remote = stats.get(pair.remoteCandidateId);
    const types = [local?.candidateType, remote?.candidateType];
    let label = 'Route unavailable';
    if (types.includes('relay')) label = 'Relayed via TURN';
    else if (types.every(Boolean)) label = 'Direct peer connection';
    const seconds = pair.currentRoundTripTime;
    return {
      label,
      localType: local?.candidateType,
      remoteType: remote?.candidateType,
      protocol: local?.protocol?.toUpperCase(),
      roundTripMs: Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : undefined
    };
  }
  return {label: 'Route unavailable'};
}
