import { planConversationAssessment } from "./conversationAssessment";
import { CLAIM_TYPES, type LimitationsSnapshot } from "./types";
import {
  CONVERSATION_LABELS,
  conversationFactLabel,
  conversationInput,
  conversationScreens,
  factsSummary,
  type ConversationQuestion,
  type ConversationSession,
} from "./conversationState";
import type { ConversationFactField } from "./conversationExtraction";

const extraDates: { screen: string; field: ConversationFactField; prompt: string }[] = [
  {
    screen: "minority",
    field: "birthDate",
    prompt: "What is the claimant's date of birth? You can say you don't know.",
  },
  {
    screen: "prior_action",
    field: "priorFilingDate",
    prompt:
      "When was the earlier lawsuit or administrative claim filed? Describe each proceeding separately if there was more than one.",
  },
  {
    screen: "prior_action",
    field: "dismissalDate",
    prompt:
      "When was it dismissed or otherwise ended? If it is still pending, say so; no end date will be assumed.",
  },
  {
    screen: "prior_action",
    field: "refilingDate",
    prompt: "Was it refiled? If so, when? You can say it has not been refiled.",
  },
  {
    screen: "agreement",
    field: "agreementStartDate",
    prompt:
      "What starting date does the agreement give for its time-limit provision? Describe the wording and scope if you have them.",
  },
  {
    screen: "agreement",
    field: "agreementEndDate",
    prompt:
      "What ending date or termination event does that agreement specify? If it is uncertain, say so.",
  },
  {
    screen: "bankruptcy",
    field: "bankruptcyStartDate",
    prompt:
      "When did the bankruptcy or order stopping proceedings begin, and what proceeding did it cover?",
  },
  {
    screen: "bankruptcy",
    field: "bankruptcyEndDate",
    prompt:
      "When did the bankruptcy or stay end? If it is still in effect or you don't know, say that.",
  },
  {
    screen: "military",
    field: "militaryStartDate",
    prompt: "When did the relevant military service begin?",
  },
  {
    screen: "military",
    field: "militaryEndDate",
    prompt: "When did that service end? You can say it is ongoing or unknown.",
  },
  {
    screen: "incapacity",
    field: "capacityStartDate",
    prompt:
      "When did the condition affecting the claimant's ability to manage their affairs begin?",
  },
  {
    screen: "incapacity",
    field: "capacityEndDate",
    prompt: "When did that condition end? You can say it is ongoing or unknown.",
  },
  {
    screen: "concealment",
    field: "concealmentEndDate",
    prompt:
      "When did the claimant learn of the hidden information or misleading conduct? What did they learn?",
  },
  {
    screen: "government",
    field: "noticeDate",
    prompt:
      "Was a notice or administrative claim presented to the public body? If so, when and to which body?",
  },
  {
    screen: "death",
    field: "representativeAppointmentDate",
    prompt:
      "Was an estate representative appointed? If so, on what date? You can say this has not happened or is unknown.",
  },
  {
    screen: "calendar",
    field: "serviceDate",
    prompt:
      "Was any complaint or claim served? If so, on what date? Describe any known filing cutoff or court order as well.",
  },
];

export type ConversationPrompt = ConversationQuestion & {
  explanation: string;
  options?: { value: string; label: string }[];
};

export function nextConversationPrompt(
  snapshot: LimitationsSnapshot,
  session: ConversationSession,
): ConversationPrompt {
  const conflict = Object.entries(session.conflicts)[0];
  if (conflict) {
    const field = conflict[0] as ConversationFactField;
    const values = [
      ...new Set(conflict[1]!.map((fact) => conversationFactLabel(field, fact.value))),
    ];
    return {
      id: `conflict:${field}`,
      kind: "clarify",
      field,
      text: `I have different values for ${CONVERSATION_LABELS[field].toLowerCase()}: ${values.join("; ")}. Is one a correction, or do both apply? If both apply, I will preserve them as unresolved rather than choose one. Say “review unresolved facts” to see the source review with the date withheld.`,
      explanation:
        "I will keep the calculation withheld until this conflict is resolved. Separate claims need separate assessments.",
    };
  }
  const uncertain = Object.values(session.facts).find((fact) => fact?.certainty === "uncertain");
  if (uncertain)
    return {
      id: `uncertain:${uncertain.field}`,
      kind: "clarify",
      field: uncertain.field,
      text: `Please clarify ${CONVERSATION_LABELS[uncertain.field].toLowerCase()}. You said “${uncertain.evidence.quote}”. Give an exact answer if you can, or say you don't know.`,
      explanation:
        "Approximate dates, ranges and ambiguous numeric dates are not converted into exact dates.",
    };

  const input = conversationInput(session.facts),
    screens = conversationScreens(session.facts);
  const plan = planConversationAssessment(snapshot, input, screens);
  const selection = plan.questions.find(
    (question) =>
      question.kind === "selection" &&
      question.field !== "vitalStatus" &&
      !session.facts[question.field!],
  );
  if (selection)
    return {
      id: selection.id,
      kind: "fact",
      field: selection.field!,
      text: selection.prompt,
      explanation: selection.explanation,
      ...(selection.options ? { options: selection.options } : {}),
    };
  if (input.jurisdiction && CLAIM_TYPES.includes(input.claimType)) {
    for (const [field, text] of [
      [
        "eventState",
        "In which state did the relevant events happen? Mention every state involved.",
      ],
      [
        "forumState",
        "Where are you planning to file, or where is the case already pending? If that is undecided, say so.",
      ],
      [
        "residenceState",
        "In which state did the claimant live when the relevant events happened? Mention moves that may matter.",
      ],
    ] as const) {
      if (!session.facts[field])
        return {
          id: `geography:${field}`,
          kind: "fact",
          field,
          text,
          explanation:
            "These are geographical facts. Residence, event location and filing location can differ; none alone determines governing law.",
        };
    }
    const variants = snapshot.rules.filter(
      (rule) =>
        rule.jurisdiction === input.jurisdiction &&
        rule.claimType === input.claimType &&
        rule.ruleKind === "limitations",
    );
    if (
      !session.facts.subtype &&
      new Set(variants.map((rule) => rule.subtype ?? "general")).size > 1
    )
      return {
        id: "fact:subtype",
        kind: "fact",
        field: "subtype",
        text: "Tell me more about the kind of claim or injury. The source release has several branches; I need to distinguish them before calculating.",
        explanation:
          "Describe the facts in your own words. Selecting a branch explores its rule; it does not certify that the rule applies.",
        options: variants.map((rule) => ({
          value: rule.subtype ?? "general",
          label: rule.summary || rule.scope,
        })),
      };
  }
  for (const question of plan.questions) {
    const field: ConversationFactField | undefined = question.screenId
      ? `screen:${question.screenId}`
      : question.field;
    if (!field || session.facts[field]) continue;
    return {
      id: question.id,
      kind: "fact",
      field,
      text: question.prompt,
      explanation: question.explanation,
      ...(question.options ? { options: question.options } : {}),
    };
  }
  const extra = extraDates.find(
    (question) =>
      screens[question.screen as keyof typeof screens] === "yes" && !session.facts[question.field],
  );
  if (extra)
    return {
      id: `event:${extra.field}`,
      kind: "fact",
      field: extra.field,
      text: extra.prompt,
      explanation:
        "This records a potentially relevant event. Its legal effect and any extension still need supported authority; I will not add this interval automatically.",
    };
  if (session.confirmedRevision !== session.revision)
    return {
      id: "confirm-facts",
      kind: "confirm_facts",
      text: `Here is my understanding:\n\n${factsSummary(session) || "No usable facts have been established."}\n\nIs this an accurate account of your facts? You can say yes or correct anything in normal language.`,
      explanation:
        "You are confirming the facts you reported, not certifying governing law, legal accrual, current law or a filing deadline.",
    };
  return {
    id: "conditional-scenario",
    kind: "scenario",
    text: "I can check whether the recorded rule supports a conditional calendar illustration. It assumes the selected state's law and claim branch apply, and that your proposed event dates are the legally relevant starting points. It applies no unsupported extension; all recorded legal qualifications remain unresolved. Would you like me to calculate under those assumptions?",
    explanation:
      "A conditional illustration is not a verified filing deadline. Unknown dates, conflicting facts, unsupported factors or source gaps will keep the date withheld.",
  };
}

export function promptContent(prompt: ConversationPrompt): string {
  const options = prompt.options
    ?.slice(0, 12)
    .map((option) => `• ${option.value.replaceAll("_", " ")}: ${option.label}`)
    .join("\n");
  return `${prompt.text}${options ? `\n\n${options}` : ""}`;
}

export async function conversationEvidenceDigest(contextKey: string | null): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(contextKey ?? "no-supported-rule"),
  );
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
