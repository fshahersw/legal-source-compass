"""Offline Python oracle vectors for the private integer-only JSONB serializer.

This script does not connect to a database. The generated SQL is read-only
validation for the release owner after applying the private helper migration.
"""
import argparse
import hashlib
import json
from pathlib import Path


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def supported(value):
    if value is None or type(value) in (bool, int):
        return True
    if type(value) is str:
        return "\x00" not in value and not any(0xD800 <= ord(c) <= 0xDFFF for c in value)
    if type(value) is list:
        return all(supported(v) for v in value)
    if type(value) is dict:
        return all(type(k) is str and supported(k) and supported(v) for k, v in value.items())
    return False


def prepare():
    values = [
        ("empty_object", {}),
        ("empty_array", []),
        ("json_null", None),
        ("boolean_and_integer_types", [True, False, None, 0, -1, 160106453]),
        ("large_exact_integer", {"n": 123456789012345678901234567890}),
        ("native_cita_nested_attrs", {"sections": [{"section_identifier": "820.1", "citation_notes": [
            {"text": "[79 FR 1740, Jan. 10, 2014]", "attributes": {"TYPE": "N", "A": "first"}}
        ]}], "historical_scope": False}),
        ("quoted_backslash_and_spaces", {"z": "  source  spacing  ", "a": 'quote " and \\ and /'}),
        ("non_nul_c0_escapes", {"controls": "".join(chr(i) for i in range(1, 32))}),
        ("del_and_unicode_separators", "\x7f\u2028\u2029"),
        ("unicode_scalar_values", {"é": "precomposed", "e\u0301": "combining", "中": "文", "😀": "non-BMP"}),
        ("utf8_c_key_order", {"😀": 4, "\ue000": 3, "é": 2, "z": 1}),
        ("escaped_object_keys", {"line\nkey": "tab\tvalue", 'quote"key': "\\path", "A": []}),
        ("nested_array_order", {"b": [[3, 2, 1], {}, [False, None]], "a": {"zz": 1, "a": 2}}),
        ("literal_percent_native_path", {"native_id": "title-40/appendix-Appendix%20J", "children": ["native:%2F"]}),
    ]
    vectors = []
    for identifier, value in values:
        assert supported(value), identifier
        text = canonical(value)
        raw = text.encode("utf-8")
        # Input deliberately retains insertion order and spacing; the expected
        # compact C/code-point key order comes only from the Python normalizer.
        input_json = json.dumps(value, ensure_ascii=False, separators=(", ", ": "))
        assert json.loads(input_json) == value
        vectors.append({"id": identifier, "input_json": input_json, "canonical_json": text,
                        "sha256": hashlib.sha256(raw).hexdigest(), "utf8_bytes": len(raw)})
    assert canonical({"😀": 4, "\ue000": 3, "é": 2, "z": 1}) == '{"z":1,"é":2,"\ue000":3,"😀":4}'
    assert not supported(1.0) and not supported(float("nan")) and not supported("\x00")
    assert not supported("\ud800")
    return {"schemaVersion": "python-integer-canonical-vectors/1", "databaseExecuted": False,
            "oracle": "Python json.dumps ensure_ascii=False, sort_keys=True, comma/colon separators",
            "positiveVectors": vectors,
            "unsupportedOriginalRepresentations": [
                {"input": "1.0", "reason": "Original float type is outside the audited integer domain."},
                {"input": "1e3", "reason": "JSONB may erase exponent/type distinction; Python normalizes this to 1000.0. Original-domain proof is necessary."},
                {"input": "NaN / Infinity", "reason": "Not valid PostgreSQL JSONB numeric values."},
                {"input": "U+0000 or lone surrogate", "reason": "Not representable as PostgreSQL UTF8 JSONB scalar text."}
            ]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="database/contracts/canonical-jsonb-vectors-v1.json")
    parser.add_argument("--sql", default="database/contracts/verify-canonical-jsonb-vectors-v1.sql")
    args = parser.parse_args()
    fixture = prepare()
    serialized = json.dumps(fixture, ensure_ascii=False, indent=2) + "\n"
    Path(args.output).write_text(serialized, encoding="utf-8", newline="\n")
    delimiter = "$canonical_vectors_" + hashlib.sha256(serialized.encode()).hexdigest()[:16] + "$"
    assert delimiter not in serialized
    query = """-- Generated offline Python oracle. Run only after applying the private helper.
-- Does not modify tables or functions. Failed scalar/UTF8 assertions must block canonical verification.
with fixture as (select %s%s%s::jsonb doc), vectors as (
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
""" % (delimiter, serialized, delimiter)
    Path(args.sql).write_text(query, encoding="utf-8", newline="\n")
    print(json.dumps({"offlineOracleVectorsPrepared": len(fixture["positiveVectors"]), "databaseExecuted": False,
                      "fixture": args.output, "verificationSql": args.sql}))


if __name__ == "__main__":
    main()
