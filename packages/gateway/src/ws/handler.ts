// WebSocket Handler - Agent 双向实时通信
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';

interface AgentSession {
  id: string;
  ws: WebSocket;
  connectedAt: number;
  lastPing: number;
}

const sessions = new Map<string, AgentSession>();

export function setupWsHandler(wss: WebSocketServer, deps: any) {
  wss.on('connection', (ws: WebSocket, req) => {
    const sessionId = randomUUID();
    const ip = req.socket.remoteAddress ?? 'unknown';

    sessions.set(sessionId, {
      id: sessionId,
      ws,
      connectedAt: Date.now(),
      lastPing: Date.now(),
    });

    deps.audit.log({
      action: 'ws_connect',
      category: 'network',
      actor: { type: 'agent', id: ip },
      outcome: 'success',
      detail: `Agent session ${sessionId} connected`,
    });

    // 发送欢迎消息
    ws.send(JSON.stringify({
      type: 'connected',
      sessionId,
      system: 'aether-gateway',
      timestamp: new Date().toISOString(),
    }));

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === 'ping') {
          const session = sessions.get(sessionId);
          if (session) session.lastPing = Date.now();
          ws.send(JSON.stringify({ type: 'pong', sessionId, timestamp: new Date().toISOString() }));
          return;
        }

        if (msg.type === 'execute') {
          // Manifest 审计
          const validation = deps.manifest.validate({
            operation: msg.operation ?? 'exec',
            target: msg.target,
            manifestName: msg.manifestName,
          });

          deps.audit.log({
            action: 'ws_execute',
            category: 'agent_execution',
            actor: { type: 'agent', id: ip },
            outcome: validation.allowed ? 'success' : 'failure',
            detail: validation.allowed
              ? `WS execute allowed for session ${sessionId}`
              : `WS execute REJECTED: ${validation.reason}`,
            metadata: { sessionId, operation: msg.operation },
          });

          if (!validation.allowed) {
            ws.send(JSON.stringify({
              type: 'error',
              code: 'MANIFEST_REJECTED',
              reason: validation.reason,
              requestId: msg.requestId,
            }));
            return;
          }

          // TODO: 转发到 WASM 沙箱
          ws.send(JSON.stringify({
            type: 'queued',
            requestId: msg.requestId ?? randomUUID(),
            sessionId,
            timestamp: new Date().toISOString(),
          }));
          return;
        }

        deps.audit.log({
          action: 'ws_unknown_message',
          category: 'network',
          actor: { type: 'agent', id: ip },
          outcome: 'failure',
          detail: `Unknown message type: ${msg.type}`,
        });

      } catch {
        ws.send(JSON.stringify({ type: 'error', code: 'PARSE_ERROR', message: 'Invalid JSON' }));
      }
    });

    ws.on('close', () => {
      sessions.delete(sessionId);
      deps.audit.log({
        action: 'ws_disconnect',
        category: 'network',
        actor: { type: 'agent', id: ip },
        outcome: 'success',
        detail: `Agent session ${sessionId} disconnected`,
      });
    });

    ws.on('error', (err) => {
      deps.audit.log({
        action: 'ws_error',
        category: 'network',
        actor: { type: 'agent', id: ip },
        outcome: 'failure',
        detail: `Session ${sessionId} error: ${err.message}`,
      });
    });
  });

  // 心跳检测，清理僵尸连接
  setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastPing > 60000) {
        session.ws.terminate();
        sessions.delete(id);
      }
    }
  }, 30000);

  console.log('[aether:gateway] 🔌 WebSocket handler ready at /ws');
}

export function getActiveSessions() {
  return Array.from(sessions.values()).map((s) => ({
    id: s.id,
    connectedAt: new Date(s.connectedAt).toISOString(),
    lastPing: new Date(s.lastPing).toISOString(),
  }));
}
