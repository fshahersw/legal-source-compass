-- Generated offline Python oracle. Run only after applying the private helper.
-- Does not modify tables or functions. Failed scalar/UTF8 assertions must block canonical verification.
with fixture as (select $canonical_vectors_9836ea6f46996b87${
  "schemaVersion": "python-integer-canonical-vectors/1",
  "databaseExecuted": false,
  "oracle": "Python json.dumps ensure_ascii=False, sort_keys=True, comma/colon separators",
  "positiveVectors": [
    {
      "id": "empty_object",
      "input_json": "{}",
      "canonical_json": "{}",
      "sha256": "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
      "utf8_bytes": 2
    },
    {
      "id": "empty_array",
      "input_json": "[]",
      "canonical_json": "[]",
      "sha256": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
      "utf8_bytes": 2
    },
    {
      "id": "json_null",
      "input_json": "null",
      "canonical_json": "null",
      "sha256": "74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b",
      "utf8_bytes": 4
    },
    {
      "id": "boolean_and_integer_types",
      "input_json": "[true, false, null, 0, -1, 160106453]",
      "canonical_json": "[true,false,null,0,-1,160106453]",
      "sha256": "6d5992f756cfc60bdc31aef6daaff8fe76b7e0e94adf5d371a2894c3b796f7ab",
      "utf8_bytes": 32
    },
    {
      "id": "large_exact_integer",
      "input_json": "{\"n\": 123456789012345678901234567890}",
      "canonical_json": "{\"n\":123456789012345678901234567890}",
      "sha256": "03b8f78ef5e8a305f4cda82942db0c6accec4046b40457ae19055ea5e4fff2ac",
      "utf8_bytes": 36
    },
    {
      "id": "native_cita_nested_attrs",
      "input_json": "{\"sections\": [{\"section_identifier\": \"820.1\", \"citation_notes\": [{\"text\": \"[79 FR 1740, Jan. 10, 2014]\", \"attributes\": {\"TYPE\": \"N\", \"A\": \"first\"}}]}], \"historical_scope\": false}",
      "canonical_json": "{\"historical_scope\":false,\"sections\":[{\"citation_notes\":[{\"attributes\":{\"A\":\"first\",\"TYPE\":\"N\"},\"text\":\"[79 FR 1740, Jan. 10, 2014]\"}],\"section_identifier\":\"820.1\"}]}",
      "sha256": "bd4e6710912b2e500b1cc8d41b89194d94aad9ffaa5f176bafc493e01fe09f03",
      "utf8_bytes": 166
    },
    {
      "id": "quoted_backslash_and_spaces",
      "input_json": "{\"z\": \"  source  spacing  \", \"a\": \"quote \\\" and \\\\ and /\"}",
      "canonical_json": "{\"a\":\"quote \\\" and \\\\ and /\",\"z\":\"  source  spacing  \"}",
      "sha256": "abd037bdd92f0c0afd9d333c100e934753a3dcb98f854466121ea63be022d405",
      "utf8_bytes": 55
    },
    {
      "id": "non_nul_c0_escapes",
      "input_json": "{\"controls\": \"\\u0001\\u0002\\u0003\\u0004\\u0005\\u0006\\u0007\\b\\t\\n\\u000b\\f\\r\\u000e\\u000f\\u0010\\u0011\\u0012\\u0013\\u0014\\u0015\\u0016\\u0017\\u0018\\u0019\\u001a\\u001b\\u001c\\u001d\\u001e\\u001f\"}",
      "canonical_json": "{\"controls\":\"\\u0001\\u0002\\u0003\\u0004\\u0005\\u0006\\u0007\\b\\t\\n\\u000b\\f\\r\\u000e\\u000f\\u0010\\u0011\\u0012\\u0013\\u0014\\u0015\\u0016\\u0017\\u0018\\u0019\\u001a\\u001b\\u001c\\u001d\\u001e\\u001f\"}",
      "sha256": "cdd882cf91404f3d79d78ae427b20b54313bc92863b4912ddd96948b96f8253b",
      "utf8_bytes": 181
    },
    {
      "id": "del_and_unicode_separators",
      "input_json": "\"  \"",
      "canonical_json": "\"  \"",
      "sha256": "95df0b63167be5cce73c768a4dd6b0005aa196870fdc24ca85e0a03c1dd7a6c0",
      "utf8_bytes": 9
    },
    {
      "id": "unicode_scalar_values",
      "input_json": "{\"é\": \"precomposed\", \"é\": \"combining\", \"中\": \"文\", \"😀\": \"non-BMP\"}",
      "canonical_json": "{\"é\":\"combining\",\"é\":\"precomposed\",\"中\":\"文\",\"😀\":\"non-BMP\"}",
      "sha256": "0773ba89a6a1ad1e1ca79e673fdfd49c803c50d742cee02c105102a0a614d9a2",
      "utf8_bytes": 67
    },
    {
      "id": "utf8_c_key_order",
      "input_json": "{\"😀\": 4, \"\": 3, \"é\": 2, \"z\": 1}",
      "canonical_json": "{\"z\":1,\"é\":2,\"\":3,\"😀\":4}",
      "sha256": "8e639e2d28bf7f9fe6f3d7505798b9233b7e788dd589935ea50d9b900084e730",
      "utf8_bytes": 31
    },
    {
      "id": "escaped_object_keys",
      "input_json": "{\"line\\nkey\": \"tab\\tvalue\", \"quote\\\"key\": \"\\\\path\", \"A\": []}",
      "canonical_json": "{\"A\":[],\"line\\nkey\":\"tab\\tvalue\",\"quote\\\"key\":\"\\\\path\"}",
      "sha256": "486c0337e158f053bd12093a401034d613dfbb7105f7e563606fb9c7463ddbba",
      "utf8_bytes": 55
    },
    {
      "id": "nested_array_order",
      "input_json": "{\"b\": [[3, 2, 1], {}, [false, null]], \"a\": {\"zz\": 1, \"a\": 2}}",
      "canonical_json": "{\"a\":{\"a\":2,\"zz\":1},\"b\":[[3,2,1],{},[false,null]]}",
      "sha256": "68591a9eb1f3e9b1e1f6776cb9a05682a30effcf30debc2334ab1c254c97a65f",
      "utf8_bytes": 50
    },
    {
      "id": "literal_percent_native_path",
      "input_json": "{\"native_id\": \"title-40/appendix-Appendix%20J\", \"children\": [\"native:%2F\"]}",
      "canonical_json": "{\"children\":[\"native:%2F\"],\"native_id\":\"title-40/appendix-Appendix%20J\"}",
      "sha256": "c555f5e0919eea57d3ac5cd5e64210d79a7283a3d7a19d119cd2e36c4f73a06a",
      "utf8_bytes": 72
    }
  ],
  "unsupportedOriginalRepresentations": [
    {
      "input": "1.0",
      "reason": "Original float type is outside the audited integer domain."
    },
    {
      "input": "1e3",
      "reason": "JSONB may erase exponent/type distinction; Python normalizes this to 1000.0. Original-domain proof is necessary."
    },
    {
      "input": "NaN / Infinity",
      "reason": "Not valid PostgreSQL JSONB numeric values."
    },
    {
      "input": "U+0000 or lone surrogate",
      "reason": "Not representable as PostgreSQL UTF8 JSONB scalar text."
    }
  ]
}
$canonical_vectors_9836ea6f46996b87$::jsonb doc), vectors as (
  select x->>'id' id,(x->>'input_json')::jsonb input_value,x->>'canonical_json' expected_text,
    x->>'sha256' expected_sha256,(x->>'utf8_bytes')::integer expected_bytes
  from fixture cross join lateral jsonb_array_elements(doc->'positiveVectors') x
), computed as materialized (
  select *,corpus_ingest.canonical_integer_jsonb_v1(input_value) actual_text,
    corpus_ingest.canonical_integer_jsonb_sha256_v1(input_value) actual_sha256 from vectors
)
select count(*) vectors_checked,
  count(*)filter(where actual_text is distinct from expected_text) serialization_mismatches,
  count(*)filter(where actual_sha256 is distinct from expected_sha256) hash_mismatches,
  count(*)filter(where octet_length(convert_to(actual_text,'UTF8')) is distinct from expected_bytes) byte_length_mismatches,
  current_setting('server_encoding')='UTF8' utf8_database,
  corpus_ingest.canonical_integer_jsonb_v1(null::jsonb) is null and
    corpus_ingest.canonical_integer_jsonb_sha256_v1(null::jsonb) is null sql_null_stays_sql_null,
  (select jsonb_agg(jsonb_build_object('id',id,'text_matches',actual_text=expected_text,'hash_matches',actual_sha256=expected_sha256))
    from computed where actual_text is distinct from expected_text or actual_sha256 is distinct from expected_sha256) failures
from computed;
