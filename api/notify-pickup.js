import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.GCP_PROJECT_ID,
      clientEmail: process.env.GCP_CLIENT_EMAIL,
      privateKey: process.env.GCP_PRIVATE_KEY?.replace(/\n/g, "\n"),
    }),
  });
}

const db = admin.firestore();
const messaging = admin.messaging();

const SHARED_SECRET = process.env.INTERNAL_SHARED_SECRET;

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
    if (req.headers["x-internal-auth"] !== SHARED_SECRET) return res.status(401).send("Unauthorized");

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyStr = Buffer.concat(chunks).toString("utf8") || "{}";
    let payload;
    try { payload = JSON.parse(bodyStr); } catch { payload = {}; }

    const code = String(payload.code || "").toUpperCase();
    if (!code) return res.status(400).json({ error: "code required" });

    const doc = await db.collection("delegations").doc(code).get();
    if (!doc.exists) return res.status(404).json({ error: "delegation not found" });
    const data = doc.data();
    const parentUid = data?.parentUid;
    if (!parentUid) return res.status(400).json({ error: "missing parentUid" });

    const tokensSnap = await db.collection("users").doc(parentUid).collection("tokens").get();
    const tokens = tokensSnap.docs.map(d => d.id).filter(Boolean);
    if (!tokens.length) return res.status(200).json({ ok: true, sent: 0 });

    const childName = data?.child?.name || "votre enfant";

    await messaging.sendEachForMulticast({
      tokens,
      notification: {
        title: "Récupération confirmée",
        body: `${childName} a été récupéré(e) par la personne désignée.`,
      },
      data: { type: "pickup_confirmed", code },
    });

    return res.status(200).json({ ok: true, sent: tokens.length });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e) });
  }
}
