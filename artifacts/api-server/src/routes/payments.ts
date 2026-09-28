import { Router } from "express";
import { db } from "@workspace/db";
import {
  portalSettingsTable,
  studentsTable,
  membershipPaymentsTable,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import Stripe from "stripe";

const router = Router();

async function getSetting(key: string): Promise<string | null> {
  const rows = await db.select().from(portalSettingsTable).where(eq(portalSettingsTable.key, key));
  return rows[0]?.value ?? null;
}

// GET /api/payments/config — returns publishable key for the frontend (safe to expose)
router.get("/config", async (_req, res) => {
  const publishableKey = await getSetting("stripe_publishable_key");
  res.json({ publishableKey: publishableKey ?? "" });
});

// POST /api/payments/create-intent — creates a Stripe PaymentIntent
router.post("/create-intent", async (req, res) => {
  try {
    const { amount, studentCode, studentName, description } = req.body as {
      amount: number;      // in cents
      studentCode: string;
      studentName: string;
      description: string;
    };

    if (!amount || amount < 100) {
      res.status(400).json({ error: "Invalid payment amount." });
      return;
    }

    const secretKey = await getSetting("stripe_secret_key");
    if (!secretKey || secretKey.startsWith("sk_test_placeholder") || secretKey === "") {
      res.status(503).json({
        error: "Payment gateway is not yet configured. Please contact the Gurukul office to complete payment.",
        notConfigured: true,
      });
      return;
    }

    const stripe = new Stripe(secretKey);
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: "usd",
      description,
      metadata: { studentCode, studentName },
    });

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err: unknown) {
    console.error("Stripe create-intent error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to initiate payment. Please try again.",
    });
  }
});

// POST /api/payments/record-membership
// Called from the parent portal after Stripe confirms a successful payment.
//
// Security model (strictly enforced):
//  - paymentIntentId is REQUIRED — no upsert without verified Stripe proof.
//  - Stripe must be configured — endpoint rejects when secret key is missing.
//  - intent.status must === "succeeded" — no partial/pending intents accepted.
//  - intent.metadata.studentCode must === studentCode — prevents replay across students.
//  - amountDue read from portal settings server-side (never trusted from client).
//  - amountPaid derived from intent.amount/100 (Stripe-verified, cannot be forged).
router.post("/record-membership", async (req, res) => {
  try {
    const { studentCode, paymentIntentId } = req.body as {
      studentCode:     string;
      paymentIntentId: string | undefined;
    };

    if (!studentCode || typeof studentCode !== "string") {
      res.status(400).json({ error: "studentCode is required" });
      return;
    }

    // paymentIntentId is mandatory — no upsert without Stripe proof
    if (!paymentIntentId || typeof paymentIntentId !== "string") {
      res.status(400).json({ error: "paymentIntentId is required to record a membership payment" });
      return;
    }

    // Stripe must be configured
    const secretKey = await getSetting("stripe_secret_key");
    if (!secretKey || secretKey.startsWith("sk_test_placeholder") || secretKey === "") {
      res.status(503).json({
        error: "Payment gateway is not configured — please contact the Gurukul office to record your payment.",
        notConfigured: true,
      });
      return;
    }

    // Look up the student to find the linked member
    const [student] = await db
      .select({ memberId: studentsTable.memberId })
      .from(studentsTable)
      .where(eq(studentsTable.studentCode, studentCode))
      .limit(1);

    if (!student?.memberId) {
      res.status(404).json({ error: "Student or linked member not found" });
      return;
    }

    // Verify PaymentIntent with Stripe
    const stripe  = new Stripe(secretKey);
    const intent  = await stripe.paymentIntents.retrieve(paymentIntentId);

    // 1. Confirm payment succeeded
    if (intent.status !== "succeeded") {
      res.status(400).json({ error: "Payment has not succeeded — cannot record as paid." });
      return;
    }

    // 2. Bind intent to this specific student — prevent cross-student replay
    const metaCode = (intent.metadata as Record<string, string>).studentCode ?? "";
    if (metaCode !== studentCode) {
      res.status(403).json({ error: "PaymentIntent does not belong to this student." });
      return;
    }

    // Read membership fee from portal settings (server-side — never from client)
    const mfSetting = await getSetting("stripe_membership_fee");
    const amountDue = mfSetting ? parseFloat(mfSetting) : 150;

    // The PaymentIntent covers the full registration total (membership + course fees).
    // We record only the membership portion: amountPaid = amountDue when the
    // total paid covers at least the membership fee; partial otherwise.
    // Amounts are always set from portal settings — never from client.
    const totalPaid = intent.amount / 100;
    const amountPaid = totalPaid >= amountDue ? amountDue : totalPaid;
    const status: "Paid" | "Pending" = amountPaid >= amountDue ? "Paid" : "Pending";
    const today = new Date().toISOString().slice(0, 10);

    await db
      .insert(membershipPaymentsTable)
      .values({
        memberId:       student.memberId,
        membershipYear: new Date().getFullYear(),
        amountDue:      String(amountDue),
        amountPaid:     String(amountPaid),
        paymentStatus:  status,
        paymentMethod:  "Stripe",
        paymentDate:    today,
        notes:          `Verified via Stripe PaymentIntent ${paymentIntentId}`,
      })
      .onConflictDoUpdate({
        target: [membershipPaymentsTable.memberId, membershipPaymentsTable.membershipYear],
        set: {
          amountDue:     String(amountDue),
          amountPaid:    String(amountPaid),
          paymentStatus: status,
          paymentMethod: "Stripe",
          paymentDate:   today,
          notes:         `Verified via Stripe PaymentIntent ${paymentIntentId}`,
        },
      });

    res.json({ success: true, status, amountPaid, amountDue });
  } catch (err: unknown) {
    console.error("record-membership error:", err);
    res.status(500).json({ error: "Failed to record membership payment" });
  }
});

export default router;
