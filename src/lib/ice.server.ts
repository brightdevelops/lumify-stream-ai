export type IceServer = {
  urls: string;
  username?: string;
  credential?: string;
};

// Server-only: reads TURN credentials from env. Never imported by client code.
export function buildIceServers(): IceServer[] {
  const servers: IceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
  const url = process.env["TURN_URL"];
  const username = process.env["TURN_USERNAME"];
  const credential = process.env["TURN_CREDENTIAL"];
  if (url && username && credential) {
    servers.push({ urls: url, username, credential });
  }
  return servers;
}
