import { Controller, Get, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AgentAuthService } from './agent-auth.service';
import { AgentMcpService } from './agent-mcp.service';
import { publicBase } from './agent-oauth.controller';

/** The hosted MCP endpoint: https://<api>/mcp. MCP clients log in through OAuth, then send the token here. */
@ApiExcludeController()
@Controller('mcp')
export class AgentMcpController {
  constructor(
    private readonly auth: AgentAuthService,
    private readonly mcp: AgentMcpService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  async rpc(@Req() req: any, @Res() res: any) {
    const header = req.headers['authorization'] as string | undefined;
    const session = header?.startsWith('Bearer ') ? await this.auth.verifyToken(header.slice(7).trim()) : null;
    if (!session) {
      // The pointer is how a client learns where to log in.
      res.set('WWW-Authenticate', `Bearer resource_metadata="${publicBase(this.config, req)}/.well-known/oauth-protected-resource"`);
      return res.status(401).json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Log in to Loofta to use this server.' } });
    }
    const body = req.body;
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.slice(0, 20).map((m) => this.mcp.handle(session, m)))).filter(Boolean);
      return out.length ? res.status(200).json(out) : res.status(202).end();
    }
    if (!body || typeof body !== 'object') return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } });
    const out = await this.mcp.handle(session, body);
    return out ? res.status(200).json(out) : res.status(202).end();
  }

  /** No server-initiated stream: this server only answers requests. */
  @Get()
  stream(@Res() res: any) {
    res.set('Allow', 'POST').status(405).end();
  }
}
