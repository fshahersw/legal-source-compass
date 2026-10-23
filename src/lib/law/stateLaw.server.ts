import { rpcPostOptional } from "@/lib/external/rest.server";
import {
  parseSearch,
  parseSection,
  parseStates,
  parseTree,
  type StateLawEdition,
  type StateLawSearch,
  type StateLawSection,
  type StateLawStatus,
  type StateLawTree,
} from "./stateLawContract";

/**
 * Read-only access to the in-force state-law layer (database/contracts/state-law-inforce-v1.sql). Every call is a
 * SECURITY DEFINER RPC run with the server's service credentials; nothing reaches the browser but parsed rows.
 * When the contract is not applied yet, rpcPostOptional returns null and the pages show "not loaded".
 */

const TTL = 60_000;
let statesCache: { at: number; value: StateLawEdition[] } | null = null;

export async function stateLawStates(): Promise<{
  installed: boolean;
  editions: StateLawEdition[];
}> {
  if (statesCache && Date.now() - statesCache.at < TTL)
    return { installed: true, editions: statesCache.value };
  const rows = await rpcPostOptional<unknown>("state_law_states_v1", {});
  if (rows === null) return { installed: false, editions: [] };
  const editions = parseStates(rows);
  statesCache = { at: Date.now(), value: editions };
  return { installed: true, editions };
}

export async function stateLawTree(
  state: string,
  nodeId: string | null,
  offset = 0,
  limit = 400,
): Promise<StateLawTree> {
  const raw = await rpcPostOptional<unknown>("state_law_tree_v1", {
    p_state: state,
    p_node_id: nodeId,
    p_limit: limit,
    p_offset: offset,
  });
  return raw === null ? { available: false, reason: "not_installed" } : parseTree(raw);
}

export async function stateLawSection(state: string, sectionId: string): Promise<StateLawSection> {
  const raw = await rpcPostOptional<unknown>("state_law_section_v1", {
    p_state: state,
    p_section_id: sectionId,
  });
  return raw === null
    ? { available: false, reason: "not_installed", edition: null }
    : parseSection(raw);
}

export async function stateLawSearch(
  state: string,
  q: string,
  offset = 0,
  status: StateLawStatus | null = null,
): Promise<StateLawSearch> {
  const raw = await rpcPostOptional<unknown>("state_law_search_v1", {
    p_state: state,
    p_q: q,
    p_limit: 20,
    p_offset: offset,
    p_status: status,
  });
  return raw === null ? { available: false, reason: "not_installed" } : parseSearch(raw);
}
