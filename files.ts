export const maxFileSize = 8 * 1024 * 1024;
const chunkSize = 16 * 1024;

// One ordered channel per transfer. Its lifetime also identifies the transfer.
export function sendFile(peer: RTCPeerConnection, file: File): Promise<void> {
  if (file.size > maxFileSize) throw new Error('Choose a file up to 8 MiB.');
  const channel = peer.createDataChannel('file');
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => fail('Transfer timed out.'), 120_000);
    function fail(message: string) {
      clearTimeout(timeout);
      reject(new Error(message));
      channel.close();
    }
    channel.onclose = () => fail('File transfer interrupted.');
    channel.onerror = () => fail('File transfer failed.');
    channel.onmessage = ({data}) => {
      if (data !== 'received') return fail('Unexpected file response.');
      clearTimeout(timeout);
      resolve();
      channel.close();
    };
    channel.onopen = async () => {
      try {
        const bytes = await file.arrayBuffer();
        channel.send(JSON.stringify({name: file.name, size: bytes.byteLength}));
        let offset = 0;
        function pump() {
          try {
            while (offset < bytes.byteLength && channel.bufferedAmount < 256 * 1024) {
              const chunk = bytes.slice(offset, offset + chunkSize);
              channel.send(chunk);
              offset += chunk.byteLength;
            }
            if (offset === bytes.byteLength) {
              channel.onbufferedamountlow = null;
              channel.send('end');
            }
          } catch { fail('File transfer interrupted.'); }
        }
        channel.bufferedAmountLowThreshold = 64 * 1024;
        channel.onbufferedamountlow = pump;
        pump();
      } catch { fail('Could not send this file.'); }
    };
  });
}

export function receiveFile(channel: RTCDataChannel, deliver: (file: File) => void) {
  channel.binaryType = 'arraybuffer';
  let bytes: Uint8Array<ArrayBuffer> | undefined;
  let name = '';
  let offset = 0;
  let complete = false;
  const timeout = window.setTimeout(() => channel.close(), 120_000);
  channel.addEventListener('close', () => { clearTimeout(timeout); bytes = undefined; });
  channel.onmessage = ({data}) => {
    try {
      if (complete) return channel.close();
      if (!bytes) {
        if (typeof data !== 'string' || data.length > 2048) return channel.close();
        const meta = JSON.parse(data);
        if (typeof meta.name !== 'string' || !meta.name || meta.name.length > 255 ||
            !Number.isSafeInteger(meta.size) || meta.size < 0 || meta.size > maxFileSize) return channel.close();
        name = meta.name;
        bytes = new Uint8Array(meta.size);
      } else if (data instanceof ArrayBuffer && data.byteLength > 0 && data.byteLength <= chunkSize) {
        bytes.set(new Uint8Array(data), offset);
        offset += data.byteLength;
      } else if (data === 'end' && offset === bytes.length) {
        complete = true;
        deliver(new File([bytes], name, {type: 'application/octet-stream'}));
        bytes = undefined;
        channel.send('received');
      } else channel.close();
    } catch { channel.close(); }
  };
}
