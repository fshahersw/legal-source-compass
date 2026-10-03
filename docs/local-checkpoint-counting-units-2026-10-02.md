# Local evidence checkpoint counting units

The checkpoint query and generator add four optional aggregate metrics without changing historical JSON keys or artifacts. The schema continues to accept checkpoints that do not contain them; missing local counts remain unknown.

| Metric                        | Counting unit                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| `httpSourceObservations`      | Rows in the private HTTP-source observation table, cumulative across retained runs                       |
| `localFileOccurrences`        | Rows in the separate private local observation table, retaining file SHA and source ordinal              |
| `sourceRecordedRelationships` | Source-version edges outside the three approved local source namespaces                                  |
| `localPointerRelationships`   | Exact record-reference edges in the approved catalog, secondary state-law and source-registry namespaces |

Historical `sourceRecords` and `observations` retain their HTTP-observation-table counts. Historical `nativeRelationships` remains the total of all stored source-qualified relationship edges; it includes local pointers. The new relationship subsets must sum to that total and independently reconcile to their source groups. The HTTP metric must agree with both known historical aliases.

Canonical entities and payload versions include publisher identities and source-qualified local IDs. A source occurrence is not a unique case, person or legal outcome. A local pointer identifies an exact local producer or extraction reference; target matching does not independently verify its legal relevance, authority, treatment or causation. The coverage UI labels these source namespaces explicitly.

This change prepares the query, generator, schema and UI for an actual reconciled aggregate receipt. It does not run database queries, regenerate checkpoints or update historical published counts.
