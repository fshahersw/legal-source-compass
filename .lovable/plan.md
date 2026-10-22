# Turn on all AI features

No code changes. Ask AI already reads these keys. It only needs their values.

## Steps
1. Open one secure form that asks for:
   - ANTHROPIC_API_KEY (required: runs Ask AI)
   - COURTLISTENER_API_KEY (Ask AI case-law search)
   - DOCKETBIRD_API_KEY (Ask AI court-filing search)
   - OPENAI_API_KEY (voice dictation)
   - BROWSER_USE_API_KEY (source viewer for sites that block normal requests)
   - SEC_USER_AGENT (optional: your name and email, sent with SEC searches)
   You can skip any of these. Features that need a skipped key stay hidden or say "not configured", the same as today.
2. Check that LIMITATIONS_AI_PROVIDER is "lovable", so the Time Limits chat and regulatory questions work. If it is wrong, ask you to re-enter it in the secure form. The value is never shown in chat.
3. Run a short test through Ask AI, and through dictation if that key was added. Report which features respond, without showing any key value.
