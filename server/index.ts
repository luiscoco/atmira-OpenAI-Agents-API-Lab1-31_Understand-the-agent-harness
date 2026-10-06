import './env.ts';
import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import OpenAI from 'openai';
import { runLab4, recoverLab4, cancelLab4 } from './lab4.ts';
import { listLab5, retrieveLab5, deleteLab5 } from './lab5.ts';
import { createLab7Agent, retrieveLab7Agent, runLab7 } from './lab7.ts';
import { runLab8 } from './lab8.ts';
import { runLab9 } from './lab9.ts';
import { runLab10, validateLab10 } from './lab10.ts';
import { runLab11 } from './lab11.ts';
import { runLab12 } from './lab12.ts';
import { sendLab13, snapshotLab13, attachLab13 } from './lab13.ts';
import { runLab14, controlLab14 } from './lab14.ts';
import { runLab15, usageLab15 } from './lab15.ts';
import { runLab16, sessionLab16, cancelLab16 } from './lab16.ts';
import { runLab17, resolveLab17, itemsLab17 } from './lab17.ts';
import { runLab18, testLab18 } from './lab18.ts';
import { runLab19, probeLab19, clearLab19Cache, testLab19 } from './lab19.ts';
import { runLab20, decideLab20, stateLab20, editLab20, resetLab20, testLab20 } from './lab20.ts';
import { runLab21, itemsLab21, testLab21 } from './lab21.ts';
import { runLab22, discoverLab22, itemsLab22, testLab22 } from './lab22.ts';
import { runLab23, discoverLab23, testLab23 } from './lab23.ts';
import { runLab24, stateLab24, publicUrlLab24, probeLab24, setupLab24, rotateLab24, deleteLab24, testLab24, itemsLab24 } from './lab24.ts';
import { startPrivateMcp } from './lab24Mcp.ts';
import { pluginLab25, templateLab25, deleteTemplateLab25, runLab25, testLab25 } from './lab25.ts';
import { runLab26, testLab26 } from './lab26.ts';
import { runLab27, probeLab27, testLab27 } from './lab27.ts';
import { runLab28, probeLab28, testLab28 } from './lab28.ts';
import { runLab29, artifactLab29, deleteLab29, testLab29 } from './lab29.ts';
import { handleLab30 } from './lab30.ts';
import { handleLab31 } from './lab31.ts';
import { handleLab32, stopLab32 } from './lab32.ts';
import { handleLab33 } from './lab33.ts';
import { handleLab34, stopLab34 } from './lab34.ts';
import { handleLab35, stopLab35 } from './lab35.ts';
import { handleLab36, stopLab36 } from './lab36.ts';
import { handleLab37, stopLab37 } from './lab37.ts';
import { handleLab38, stopLab38 } from './lab38.ts';
import { handleDelegationLab, stopDelegationLabs } from './labs39to40.ts';
import { handleOperationsLab } from './labs41to50.ts';
import { capstoneApplication, stopCapstone } from './capstoneRoutes.ts';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'build');

// Lab 01 deliberately starts a fresh, single-turn session for every prompt.
// Session continuation is introduced in a later lab.
const agent = {
  model: process.env.OPENAI_MODEL || 'gpt-5.6-terra',
  instructions:
    'You are a friendly programming tutor. Answer clearly and concisely. ' +
    'When useful, include one short example. If you are unsure, say so.',
};

const port = Number(process.env.PORT || 5173);
const isProduction = process.env.NODE_ENV === 'production' || process.argv.includes('--production');
// Share the app's HTTP listener instead of competing for Vite's default HMR port 24678.
const server = createHttpServer();

const vite = isProduction
  ? null
  : await (await import('vite')).createServer({
      configFile: join(root, 'vite.config.js'),
      server: { middlewareMode: true, hmr: { server } },
    });

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function readJson(request): Promise<unknown> {
  let text = '';
  for await (const chunk of request) {
    text += chunk;
    if (text.length > 12_000) throw new Error('Request is too large.');
  }
  return JSON.parse(text);
}

function requestFields(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Request body must be an object.');
  }
  return value as Record<string, unknown>;
}

function writeEvent(response, event) {
  response.write(`${JSON.stringify(event)}\n`);
}

async function handleRun(request, response, lab2 = false, inspect = false) {
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_api_key_here') {
    sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
    return;
  }

  let prompt;
  let sessionId;
  let instructions;
  try {
    const body = requestFields(await readJson(request));
    prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (lab2) {
      sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
      instructions = typeof body.instructions === 'string' ? body.instructions.trim() : '';
    }
  } catch {
    sendJson(response, 400, { error: 'Send a valid JSON request with a prompt.' });
    return;
  }
  if (!prompt || prompt.length > 2000) {
    sendJson(response, 400, { error: 'Prompt must be between 1 and 2,000 characters.' });
    return;
  }
  if (lab2 && sessionId && (sessionId.length > 200 || !/^sess_[A-Za-z0-9_-]+$/.test(sessionId))) {
    sendJson(response, 400, { error: 'Invalid session ID.' });
    return;
  }
  if (lab2 && !sessionId && (!instructions || instructions.length > 4000)) {
    sendJson(response, 400, { error: 'Instructions must be between 1 and 4,000 characters.' });
    return;
  }

  response.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  let stream;
  let completed = false;
  let sessionSent = false;
  const parts = new Map();
  const partKey = (event) => `${event.item_id}:${event.output_index}:${event.content_index}`;

  try {
    if (lab2 && sessionId) {
      writeEvent(response, { type: 'session', sessionId });
      sessionSent = true;
      writeEvent(response, { type: 'status', label: 'Continuing the same session' });
      // Open the event stream before sending input so the first events are captured.
      stream = await client.beta.agents.sessions.events.stream(sessionId);
      await client.beta.agents.sessions.events.create(sessionId, {
        events: [{
          type: 'agent.session.input.message',
          input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
        }],
      });
    } else {
      writeEvent(response, { type: 'status', label: 'Starting agent session' });
      stream = await client.beta.agents.sessions.create({
        agent: lab2 ? { ...agent, instructions } : agent,
        environment: { type: 'none' },
        input: prompt,
        stream: true,
      });
    }

    for await (const event of stream) {
      if (response.destroyed) break;
      if (inspect) {
        // Forward identifiers and lifecycle metadata, never prompt or answer content.
        writeEvent(response, {
          type: 'inspect',
          event: {
            type: event.type,
            eventId: event.event_id || null,
            sessionId: event.session_id || sessionId || null,
            turnId: event.turn_id || event.turn?.id || event.item?.turn_id || null,
            itemId: event.item_id || event.item?.id || null,
            turnStatus: event.turn?.status || null,
            sessionStatus: event.session?.status || null,
            rootTurn: event.turn?.subagent_id == null,
          },
        });
      }
      if (lab2 && !sessionSent && event.session_id) {
        sessionId = event.session_id;
        sessionSent = true;
        writeEvent(response, { type: 'session', sessionId });
      }
      if (event.type === 'agent.session.turn.output_text.delta') {
        const key = partKey(event);
        parts.set(key, (parts.get(key) || '') + event.delta);
        writeEvent(response, { type: 'text', text: [...parts.values()].join('\n') });
      } else if (event.type === 'agent.session.turn.output_text.done') {
        parts.set(partKey(event), event.text);
        writeEvent(response, { type: 'text', text: [...parts.values()].join('\n') });
      } else if (event.type === 'agent.session.turn.completed' && event.turn?.subagent_id == null) {
        completed = true;
        writeEvent(response, { type: 'complete' });
        break;
      } else if (event.type === 'agent.session.turn.failed' && event.turn?.subagent_id == null) {
        throw new Error(event.turn.error?.message || 'The agent turn failed.');
      } else if (event.type === 'agent.session.turn.cancelled' && event.turn?.subagent_id == null) {
        throw new Error('The agent turn was cancelled.');
      } else if (event.type === 'error') {
        throw new Error(event.error?.message || 'The agent returned an error.');
      } else if (event.type === 'agent.session.failed' || event.type === 'agent.session.environment.failed') {
        throw new Error('The agent session failed.');
      }
    }
    if (!completed && !response.destroyed) throw new Error('The connection closed before the turn completed.');
    if (lab2 && completed && !sessionSent) throw new Error('The session finished without a session ID.');
  } catch (error) {
    if (!response.destroyed) {
      writeEvent(response, { type: 'error', message: error.message || 'Something went wrong.' });
    }
  } finally {
    stream?.controller?.abort();
    if (!response.destroyed) response.end();
  }
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

server.on('request', async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path === '/api/health' && request.method === 'GET') {
    sendJson(response, 200, {
      configured: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_api_key_here'),
      model: agent.model,
    });
    return;
  }
  if (path === '/api/run' && request.method === 'POST') {
    await handleRun(request, response);
    return;
  }
  if (path === '/api/lab2/run' && request.method === 'POST') {
    await handleRun(request, response, true);
    return;
  }
  if (path === '/api/lab3/run' && request.method === 'POST') {
    await handleRun(request, response, true, true);
    return;
  }
  if (path === '/api/lab4/run' && request.method === 'POST') {
    await runLab4(request, response, agent);
    return;
  }
  if (path === '/api/lab4/recover' && request.method === 'GET') {
    await recoverLab4(request, response);
    return;
  }
  if (path === '/api/lab4/cancel' && request.method === 'POST') {
    await cancelLab4(request, response);
    return;
  }
  if (path === '/api/lab5/sessions' && request.method === 'GET') {
    await listLab5(request, response);
    return;
  }
  if (path === '/api/lab5/session' && request.method === 'GET') {
    await retrieveLab5(request, response);
    return;
  }
  if (path === '/api/lab5/session' && request.method === 'DELETE') {
    await deleteLab5(request, response);
    return;
  }
  if (path === '/api/lab7/agent' && request.method === 'POST') {
    await createLab7Agent(request, response, agent.model);
    return;
  }
  if (path === '/api/lab7/agent' && request.method === 'GET') {
    await retrieveLab7Agent(request, response);
    return;
  }
  if (path === '/api/lab7/run' && request.method === 'POST') {
    await runLab7(request, response);
    return;
  }
  if (path === '/api/lab8/run' && request.method === 'POST') {
    await runLab8(request, response);
    return;
  }
  if (path === '/api/lab9/run' && request.method === 'POST') {
    await runLab9(request, response);
    return;
  }
  if (path === '/api/lab10/run' && request.method === 'POST') {
    await runLab10(request, response);
    return;
  }
  if (path === '/api/lab10/validate' && request.method === 'POST') {
    await validateLab10(request, response);
    return;
  }
  if (path === '/api/lab11/run' && request.method === 'POST') {
    await runLab11(request, response, agent);
    return;
  }
  if (path === '/api/lab12/run' && request.method === 'POST') {
    await runLab12(request, response, agent);
    return;
  }
  if (path === '/api/lab13/send' && request.method === 'POST') {
    await sendLab13(request, response, agent);
    return;
  }
  if (path === '/api/lab13/snapshot' && request.method === 'GET') {
    await snapshotLab13(request, response);
    return;
  }
  if (path === '/api/lab13/attach' && request.method === 'POST') {
    await attachLab13(request, response);
    return;
  }
  if (path === '/api/lab14/run' && request.method === 'POST') {
    await runLab14(request, response, agent);
    return;
  }
  if (path === '/api/lab14/control' && request.method === 'POST') {
    await controlLab14(request, response);
    return;
  }
  // Lab 14 reads saved turns and items exactly as Lab 13 does. Reading sends nothing.
  if (path === '/api/lab14/snapshot' && request.method === 'GET') {
    await snapshotLab13(request, response);
    return;
  }
  if (path === '/api/lab15/run' && request.method === 'POST') {
    await runLab15(request, response, agent);
    return;
  }
  // Lab 15 re-reads the saved turn and session usage. Reading sends nothing.
  if (path === '/api/lab15/usage' && request.method === 'GET') {
    await usageLab15(request, response);
    return;
  }
  if (path === '/api/lab16/run' && request.method === 'POST') {
    await runLab16(request, response, agent);
    return;
  }
  // Lab 16 reads the saved session, where a waiting tool request is kept. Reading sends nothing.
  if (path === '/api/lab16/session' && request.method === 'GET') {
    await sessionLab16(request, response);
    return;
  }
  if (path === '/api/lab16/cancel' && request.method === 'POST') {
    await cancelLab16(request, response);
    return;
  }
  if (path === '/api/lab17/run' && request.method === 'POST') {
    await runLab17(request, response, agent);
    return;
  }
  // Step-through: the server reads the waiting calls from the saved session, runs them, and sends the results.
  if (path === '/api/lab17/resolve' && request.method === 'POST') {
    await resolveLab17(request, response);
    return;
  }
  // Lab 17 reads the saved items, where the calls and their outputs are kept. Reading sends nothing.
  if (path === '/api/lab17/items' && request.method === 'GET') {
    await itemsLab17(request, response);
    return;
  }
  // Cancelling a waiting turn works exactly as in Lab 16.
  if (path === '/api/lab17/cancel' && request.method === 'POST') {
    await cancelLab16(request, response);
    return;
  }
  if (path === '/api/lab18/run' && request.method === 'POST') {
    await runLab18(request, response, agent);
    return;
  }
  // The tool test suite runs on this server with the same runTool the live run uses. It never calls OpenAI.
  if (path === '/api/lab18/test' && request.method === 'POST') {
    await testLab18(request, response);
    return;
  }
  // Saved items are read exactly as in Lab 17, so rejected calls show up as function_call_output with an error.
  if (path === '/api/lab18/items' && request.method === 'GET') {
    await itemsLab17(request, response);
    return;
  }
  if (path === '/api/lab19/run' && request.method === 'POST') {
    await runLab19(request, response, agent);
    return;
  }
  // The probe calls the real service through the same wrapper the agent uses, without OpenAI. No API key needed.
  if (path === '/api/lab19/probe' && request.method === 'POST') {
    await probeLab19(request, response);
    return;
  }
  if (path === '/api/lab19/cache' && request.method === 'DELETE') {
    clearLab19Cache(request, response);
    return;
  }
  // The service test suite runs against recorded responses. No network, no API key.
  if (path === '/api/lab19/test' && request.method === 'POST') {
    await testLab19(request, response);
    return;
  }
  // Saved items are read exactly as in Lab 17, so each call and its narrowed output can be inspected.
  if (path === '/api/lab19/items' && request.method === 'GET') {
    await itemsLab17(request, response);
    return;
  }
  if (path === '/api/lab20/run' && request.method === 'POST') {
    await runLab20(request, response, agent);
    return;
  }
  // The student's decision on a waiting change. The server re-checks it, records it, and resumes the turn.
  if (path === '/api/lab20/decide' && request.method === 'POST') {
    await decideLab20(request, response);
    return;
  }
  // The planner, pending approvals, and the audit log. Reading sends nothing to OpenAI.
  if (path === '/api/lab20/state' && request.method === 'GET') {
    stateLab20(request, response);
    return;
  }
  // Someone else moves an event, to show why a stale approval must not run.
  if (path === '/api/lab20/edit' && request.method === 'POST') {
    await editLab20(request, response);
    return;
  }
  if (path === '/api/lab20/reset' && request.method === 'POST') {
    resetLab20(request, response);
    return;
  }
  // The approval rules run on the server with the same engine. No network, no API key.
  if (path === '/api/lab20/test' && request.method === 'POST') {
    await testLab20(request, response);
    return;
  }
  // Saved items are read exactly as in Lab 17: each function_call and the output or error it received.
  if (path === '/api/lab20/items' && request.method === 'GET') {
    await itemsLab17(request, response);
    return;
  }
  if (path === '/api/lab21/run' && request.method === 'POST') {
    await runLab21(request, response, agent);
    return;
  }
  // The citation and declaration suite runs on the server with the same functions. No network, no API key.
  if (path === '/api/lab21/test' && request.method === 'POST') {
    testLab21(request, response);
    return;
  }
  // Saved items: the question, each web_search_call with its action, and the answer. Reading sends nothing.
  if (path === '/api/lab21/items' && request.method === 'GET') {
    await itemsLab21(request, response);
    return;
  }
  if (path === '/api/lab22/run' && request.method === 'POST') {
    await runLab22(request, response, agent);
    return;
  }
  // initialize and tools/list against the declared MCP server, so students see what the agent discovers. No OpenAI call.
  if (path === '/api/lab22/discover' && request.method === 'POST') {
    await discoverLab22(request, response);
    return;
  }
  // The declaration, discovery, and call checks run on the server with the same functions. No network, no API key.
  if (path === '/api/lab22/test' && request.method === 'POST') {
    testLab22(request, response);
    return;
  }
  // Saved items: the question, each mcp_call with its arguments and result, and the answer. Reading sends nothing.
  if (path === '/api/lab22/items' && request.method === 'GET') {
    await itemsLab22(request, response);
    return;
  }
  // The allowlist test: each probe runs in its own session with the same allowed_tools and connection_origin.
  if (path === '/api/lab23/run' && request.method === 'POST') {
    await runLab23(request, response, agent);
    return;
  }
  // tools/list for the declared server, cached briefly, so the allowlist can be checked name by name. No OpenAI call.
  if (path === '/api/lab23/discover' && request.method === 'POST') {
    await discoverLab23(request, response);
    return;
  }
  // The origin, allowlist, visibility, and probe checks run on the server with the same functions. No network, no API key.
  if (path === '/api/lab23/test' && request.method === 'POST') {
    testLab23(request, response);
    return;
  }
  // Saved items of one probe session. The reader is the same as Lab 22's: it lists mcp_call items and messages.
  if (path === '/api/lab23/items' && request.method === 'GET') {
    await itemsLab22(request, response);
    return;
  }
  // Lab 24: the private MCP server's tokens (versions only), the vault's metadata, and the access log. Never a secret.
  if (path === '/api/lab24/state' && request.method === 'GET') {
    await stateLab24(request, response);
    return;
  }
  // The tunnel's public https URL for the private MCP server. Not a secret.
  if (path === '/api/lab24/public-url' && request.method === 'POST') {
    await publicUrlLab24(request, response);
    return;
  }
  // No token, a wrong token, and each issued token against the private server, on this machine. No OpenAI call.
  if (path === '/api/lab24/probe' && request.method === 'POST') {
    await probeLab24(request, response);
    return;
  }
  // Create (or reuse) the vault and store the current token as a write-only credential.
  if (path === '/api/lab24/vault' && request.method === 'POST') {
    await setupLab24(request, response);
    return;
  }
  if (path === '/api/lab24/vault' && request.method === 'DELETE') {
    await deleteLab24(request, response);
    return;
  }
  // Rotation, one step at a time: mint a token, update the vault, revoke the old token.
  if (path === '/api/lab24/rotate' && request.method === 'POST') {
    await rotateLab24(request, response);
    return;
  }
  // One question to the private server, with the credential from the vault, inline, or none.
  if (path === '/api/lab24/run' && request.method === 'POST') {
    await runLab24(request, response, agent);
    return;
  }
  // The declaration, matching, secret, rotation, and judgement checks on the server. No network, no API key.
  if (path === '/api/lab24/test' && request.method === 'POST') {
    testLab24(request, response);
    return;
  }
  // Saved items of a Lab 24 session, read exactly as in Lab 22.
  if (path === '/api/lab24/items' && request.method === 'GET') {
    await itemsLab24(request, response);
    return;
  }
  // Lab 25: the plugin folder from disk, and the environment template's metadata. Never the archive.
  if (path === '/api/lab25/plugin' && request.method === 'GET') {
    await pluginLab25(request, response);
    return;
  }
  // Store the packed plugin once in an environment template, or replace it there.
  if (path === '/api/lab25/template' && request.method === 'POST') {
    await templateLab25(request, response);
    return;
  }
  if (path === '/api/lab25/template' && request.method === 'DELETE') {
    await deleteTemplateLab25(request, response);
    return;
  }
  // One question in a new hosted session: plugin inline, from the template, or none. Asks once the environment is ready.
  if (path === '/api/lab25/run' && request.method === 'POST') {
    await runLab25(request, response, agent);
    return;
  }
  // The manifest, skill, MCP, packing, install, and judgement checks on the server. No network, no API key.
  if (path === '/api/lab25/test' && request.method === 'POST') {
    testLab25(request, response);
    return;
  }
  // Lab 26: one task in a new session, in the environment the student chose (none or openai_hosted).
  if (path === '/api/lab26/run' && request.method === 'POST') {
    await runLab26(request, response, agent);
    return;
  }
  // The compute, chooser, request, answer, and judgement checks on the server. No network, no API key.
  if (path === '/api/lab26/test' && request.method === 'POST') {
    testLab26(request, response);
    return;
  }
  // Lab 27: a report task in a new hosted session, with the input files staged at creation, copied in, or missing.
  if (path === '/api/lab27/run' && request.method === 'POST') {
    await runLab27(request, response, agent);
    return;
  }
  // Sends a files request the checker refuses, to show the API's own answer. Accepted requests are not sent.
  if (path === '/api/lab27/probe' && request.method === 'POST') {
    await probeLab27(request, response, agent);
    return;
  }
  // The dataset, base64, files-request, report, and judgement checks on the server. No network, no API key.
  if (path === '/api/lab27/test' && request.method === 'POST') {
    testLab27(request, response);
    return;
  }
  // Lab 28: an audit or install task in a new hosted session, with the packages and network policy the student chose.
  if (path === '/api/lab28/run' && request.method === 'POST') {
    await runLab28(request, response, agent);
    return;
  }
  // Sends an environment the checker refuses, to show the API's own answer. Accepted requests are not sent.
  if (path === '/api/lab28/probe' && request.method === 'POST') {
    await probeLab28(request, response, agent);
    return;
  }
  // The config, request, evidence, judgement, and policy-document checks on the server. No network, no API key.
  if (path === '/api/lab28/test' && request.method === 'POST') {
    testLab28(request, response);
    return;
  }
  // One task in a new hosted session, then list, identify, and download what the turn published.
  if (path === '/api/lab29/run' && request.method === 'POST') {
    await runLab29(request, response, agent);
    return;
  }
  // The download proxy: metadata first, then the immutable bytes under a safe name and type.
  if (path === '/api/lab29/artifact' && request.method === 'GET') {
    await artifactLab29(request, response);
    return;
  }
  if (path === '/api/lab29/delete' && request.method === 'POST') {
    await deleteLab29(request, response);
    return;
  }
  // The publish, identify, download, verify, and judge checks on the server. No network, no API key.
  if (path === '/api/lab29/test' && request.method === 'POST') {
    testLab29(request, response);
    return;
  }
  if (path.startsWith('/api/lab30/')) {
    await handleLab30(request, response, path);
    return;
  }
  if (path.startsWith('/api/lab31/')) {
    await handleLab31(request, response, path);
    return;
  }
  if (path.startsWith('/api/lab32/')) {
    await handleLab32(request, response, path);
    return;
  }
  if (path.startsWith('/api/lab33/')) {
    await handleLab33(request, response, path);
    return;
  }
  if (path.startsWith('/api/lab36/')) { await handleLab36(request, response, path); return; }
  if (path.startsWith('/api/lab37/')) { await handleLab37(request, response, path); return; }
  if (path.startsWith('/api/lab38/')) { await handleLab38(request, response, path); return; }
  if (path.startsWith('/api/lab39/')) { await handleDelegationLab(request, response, path, 39); return; }
  if (path.startsWith('/api/lab40/')) { await handleDelegationLab(request, response, path, 40); return; }
  const operationsRoute = /^\/api\/lab(4[1-9]|50)\//.exec(path);
  if (operationsRoute) { await handleOperationsLab(request, response, path, Number(operationsRoute[1])); return; }
  if (path.startsWith('/api/capstone/') || /^\/api\/lab5[1-6]\//.test(path)) { await capstoneApplication().handle(request, response, path); return; }
  if (path.startsWith('/api/lab35/')) {
    await handleLab35(request, response, path);
    return;
  }
  if (path.startsWith('/api/lab34/')) {
    await handleLab34(request, response, path);
    return;
  }
  if (path.startsWith('/api/')) {
    sendJson(response, 404, { error: 'API route not found.' });
    return;
  }
  if (vite) {
    vite.middlewares(request, response, () => {});
    return;
  }
  const file = resolve(dist, `.${path === '/' ? '/index.html' : path}`);
  if (file !== dist && !file.startsWith(dist + sep)) {
    sendJson(response, 403, { error: 'Forbidden.' });
    return;
  }
  try {
    const content = await readFile(file);
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
    response.end(content);
  } catch {
    sendJson(response, 404, { error: 'Page not found.' });
  }
});

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Stop the existing course server with Ctrl+C, or choose another port in PowerShell: $env:PORT='5175'; npm run dev`);
  } else {
    console.error(`Course server could not start: ${error.message}`);
  }
  process.exit(1);
});
server.listen(port, () => {
  console.log(`Agent Labs running at http://localhost:${port}`);
  // Start the separate Lab 24 MCP listener only after the course port is acquired.
  startPrivateMcp();
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
  const deadline = setTimeout(() => process.exit(1), 45_000);
  void Promise.allSettled([stopLab32(), stopLab34(), stopLab35(), stopLab36(), stopLab37(), stopLab38(), stopDelegationLabs(), stopCapstone()]).finally(() => { clearTimeout(deadline); process.exit(0); });
});
