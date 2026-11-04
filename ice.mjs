import { createHmac, randomUUID } from 'node:crypto';

export function iceConfig(env = process.env) {
  const urls = key => (env[key] || '').split(',').map(s => s.trim()).filter(Boolean);
  const stun = urls('STUN_URLS');
  const turn = urls('TURN_URLS');
  const policy = env.ICE_TRANSPORT_POLICY || 'all';
  if (!['all', 'relay'].includes(policy) || (policy === 'relay' && !turn.length))
    throw new Error('Use all or relay for ICE_TRANSPORT_POLICY. Relay requires TURN_URLS.');
  if (stun.some(url => !/^stuns?:\S+$/i.test(url)) || turn.some(url => !/^turns?:\S+$/i.test(url)))
    throw new Error('Invalid STUN_URLS or TURN_URLS scheme.');
  if (turn.length && !env.TURN_SHARED_SECRET && !(env.TURN_USERNAME && env.TURN_PASSWORD))
    throw new Error('TURN_URLS requires TURN_SHARED_SECRET or both TURN_USERNAME and TURN_PASSWORD.');
  return () => {
    const iceServers = stun.length ? [{urls: stun}] : [];
    if (turn.length) {
      let username = env.TURN_USERNAME;
      let credential = env.TURN_PASSWORD;
      if (env.TURN_SHARED_SECRET) {
        username = Math.floor(Date.now() / 1000 + 3600) + ':' + randomUUID();
        credential = createHmac('sha1', env.TURN_SHARED_SECRET).update(username).digest('base64');
      }
      iceServers.push({urls: turn, username, credential});
    }
    return {iceServers, iceTransportPolicy: policy};
  };
}
