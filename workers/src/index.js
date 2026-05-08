// =============================================================
//  LearningForge Worker - Entry point
// -------------------------------------------------------------
//  Mirrors the four Firebase Cloud Functions from
//  functions/index.js, dispatched by URL path:
//
//    POST /submitTestResult         (auth required)
//    POST /unlockCosmetic           (auth required)
//    POST /getParentShareReport     (UNAUTH - public)
//    POST /markTestAccount          (auth required)
//    POST /submitDailyChallenge     (auth required)  [Mission 9]
//    POST /submitTopicForApproval   (auth required)  [Phase 3c]
//    POST /approveTopicForPublic    (auth required, admin only) [Phase 3c]
//
//  Auth is per-endpoint (each handler calls requireAuth() if it
//  needs it) - this Worker is unauth-callable for the parent
//  share endpoint.
//
//  All responses are JSON; CORS is wide-open. OPTIONS preflight
//  is handled at the top.
// =============================================================

import { handleSubmitTestResult }       from './endpoints/submitTestResult.js';
import { handleUnlockCosmetic }         from './endpoints/unlockCosmetic.js';
import { handleGetParentShareReport }   from './endpoints/getParentShareReport.js';
import { handleMarkTestAccount }        from './endpoints/markTestAccount.js';
import { handleSubmitDailyChallenge }   from './endpoints/submitDailyChallenge.js';
import { handleSubmitTopicForApproval } from './endpoints/submitTopicForApproval.js';
import { handleApproveTopicForPublic }  from './endpoints/approveTopicForPublic.js';
import { json, cors, errorResponse }    from './lib/http.js';

export default {
  async fetch(request, env, ctx) {
    // CORS preflight - browsers send OPTIONS before any cross-origin POST
    // with custom headers (Authorization, Content-Type).
    if (request.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }));
    }

    const url  = new URL(request.url);
    const path = url.pathname.replace(/^\/+/, '').replace(/\/+$/, '');

    try {
      let result;
      switch (path) {
        case 'submitTestResult':
          result = await handleSubmitTestResult(request, env);
          break;
        case 'unlockCosmetic':
          result = await handleUnlockCosmetic(request, env);
          break;
        case 'getParentShareReport':
          result = await handleGetParentShareReport(request, env);
          break;
        case 'markTestAccount':
          result = await handleMarkTestAccount(request, env);
          break;
        case 'submitDailyChallenge':
          result = await handleSubmitDailyChallenge(request, env);
          break;
        case 'submitTopicForApproval':
          result = await handleSubmitTopicForApproval(request, env);
          break;
        case 'approveTopicForPublic':
          result = await handleApproveTopicForPublic(request, env);
          break;
        default:
          return cors(errorResponse(404, `unknown endpoint: ${path}`));
      }
      return cors(json(200, result));
    } catch (err) {
      const status = err?.status || 500;
      const msg    = err?.message || 'internal error';
      // Never log full error objects - they may carry token fragments
      // from upstream HTTP responses (Hard Rule 2). Log only the path
      // and status code.
      console.log(`[${path}] ${status}: ${msg}`);
      return cors(errorResponse(status, msg));
    }
  }
};
