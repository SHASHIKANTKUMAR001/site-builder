import { Request, Response } from "express";
import Stripe from "stripe";
import prisma from "../lib/prisma.js";

console.log("Stripe Webhook Controller Loaded");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

export const stripeWebhook = async (
  request: Request,
  response: Response
) => {
  const signature = request.headers["stripe-signature"] as string;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      request.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET as string
    );
  } catch (err: any) {
    console.log("⚠️ Webhook signature verification failed.", err.message);
    return response.sendStatus(400);
  }

  // ✅ HANDLE CHECKOUT SUCCESS
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    const transactionId = session.metadata?.transactionId;
    const appId = session.metadata?.appId;

    if (appId !== "ai-site-builder" || !transactionId) {
      return response.json({ received: true });
    }

    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction || transaction.isPaid) {
      return response.json({ received: true }); // prevent double crediting
    }

    // ✅ Mark as paid
    await prisma.transaction.update({
      where: { id: transactionId },
      data: { isPaid: true },
    });

    // ✅ Add credits
    await prisma.user.update({
      where: { id: transaction.userId },
      data: {
        credits: {
          increment: transaction.credits,
        },
      },
    });

    console.log("✅ Credits added successfully");
  }

  response.json({ received: true });
};