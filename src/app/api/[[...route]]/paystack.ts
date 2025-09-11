import { Hono } from "hono";
import { verifyAuth } from "@hono/auth-js";
import { eq } from "drizzle-orm";
import { db } from "@/db/drizzle";
import { subscriptions } from "@/db/schema";
import crypto from "crypto";

const app = new Hono()
  // 🚀 Checkout
  .post("/checkout", verifyAuth(), async (c) => {
    const auth = c.get("authUser");

    if (!auth.token?.id) return c.json({ error: "Unauthorized" }, 401);

    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: auth.token.email,
        amount: 500000, // ₦5000.00 = 500000 kobo
        callback_url: `${process.env.NEXT_PUBLIC_APP_URL}/paystack/callback`,
        metadata: { userId: auth.token.id },
      }),
    });

    const result = await response.json();

    if (!result.status) return c.json({ error: result.message }, 400);

    return c.json({ data: result.data.authorization_url });
  })

  // 🚀 Webhook
  .post("/webhook", async (c) => {
    const body = await c.req.json();
    const signature = c.req.header("x-paystack-signature");

    const hash = crypto
      .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY!)
      .update(JSON.stringify(body))
      .digest("hex");

    if (hash !== signature) return c.json({ error: "Invalid signature" }, 400);

    if (body.event === "charge.success") {
      const data = body.data;

      await db.insert(subscriptions).values({
        status: "active",
        userId: data.metadata.userId,
        subscriptionId: data.reference,
        customerId: data.customer.id,
        priceId: "basic_plan",
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    return c.json({ status: "success" }, 200);
  });

export default app;
