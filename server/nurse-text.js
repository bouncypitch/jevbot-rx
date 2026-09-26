// Nurse ⇄ robot text messages. Jev reads each message in one parallel pass:
// what the nurse wants, how urgent it is, and where the delivery goes.
const WARDS = {
  icu_bed_4: "ICU bed 4",
  or_2: "Operating room 2",
  lab: "Lab",
  er: "Emergency",
  none: "No destination mentioned",
};

export async function readNurseText(text, robot, env) {
  const started = performance.now();
  const res = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.TYPESAFE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "jev-latest",
      state: { text_message: text, sender: "nurse", robot },
      questions: {
        intent: {
          type: "choice",
          instructions: "What does the nurse want the hospital delivery robot to do?",
          criteria: {
            new_delivery: "Start a new delivery",
            status: "Asks where the robot is or when it will arrive",
            cancel: "Cancel or stop the current delivery",
            confirm_receipt: "Confirms the delivery was received",
            other: "Anything else",
          },
        },
        urgency: {
          type: "score",
          instructions: "How urgent is the nurse's request?",
          criteria: [
            "Routine: no time pressure",
            "Urgent: needed soon",
            "STAT: needed immediately, patient care depends on it",
          ],
        },
        destination: {
          type: "choice",
          instructions: "Where should the robot deliver to?",
          criteria: WARDS,
        },
      },
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Jev returned HTTP ${res.status}.`);
  const data = await res.json();
  const a = data.answers;
  return {
    intent: a.intent.choice,
    urgency: ["routine", "urgent", "STAT"][Math.round(a.urgency.score)] ?? "routine",
    destination: a.destination.choice,
    destination_name: WARDS[a.destination.choice],
    confidence: a.intent.confidence,
    latency_ms: Math.round(performance.now() - started),
  };
}
