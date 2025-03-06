import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { getFirestore } from "npm:firebase-admin@11.10.1/firestore";
import { initializeApp, cert } from "npm:firebase-admin@11.10.1/app";

// Initialize Firebase Firestore
const SERVICE_ACCOUNT_JSON = Deno.env.get("FIREBASE_SERVICE_ACCOUNT")!;
const SERVICE_ACCOUNT = JSON.parse(SERVICE_ACCOUNT_JSON);
const firebaseApp = initializeApp({ credential: cert(SERVICE_ACCOUNT) });
const firestore = getFirestore(firebaseApp);

// Function to send FCM notification
async function sendNotification(deviceToken: string, pHLevel: number) {
  try {
    const fcmUrl = "https://fcm.googleapis.com/fcm/send";
    const message = {
      to: deviceToken,
      notification: {
        title: "⚠️ High pH Alert!",
        body: `Warning: Your aquarium pH level is too high (${pHLevel})!`,
      },
      android: { priority: "high" },
    };

    const fcmResponse = await fetch(fcmUrl, {
      method: "POST",
      headers: {
        Authorization: `key=${Deno.env.get("FIREBASE_SERVER_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });

    const responseData = await fcmResponse.json();

    if (!fcmResponse.ok) {
      console.error("❌ FCM Error:", responseData);
      return { success: false, error: responseData };
    }

    console.log("✅ Notification sent successfully:", responseData);
    return { success: true };
  } catch (error) {
    console.error("❌ Error sending notification:", error);
    return { success: false, error };
  }
}

serve(async (req) => {
  try {
    const { userId, pHLevel } = await req.json();

    if (!userId || pHLevel === undefined || isNaN(Number(pHLevel))) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid userId or pHLevel" }),
        { status: 400 }
      );
    }

    // Fetch user's FCM token from Firestore
    const userDoc = await firestore.collection("users").doc(userId).get();

    if (!userDoc.exists) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404 }
      );
    }

    const userData = userDoc.data();
    const deviceToken = userData?.fcmToken;

    if (!deviceToken) {
      return new Response(
        JSON.stringify({ error: "No FCM token for user" }),
        { status: 400 }
      );
    }

    // Send FCM notification
    const notificationResult = await sendNotification(deviceToken, pHLevel);

    if (notificationResult.success) {
      // Store notification log in Firestore
      await firestore
        .collection("users")
        .doc(userId)
        .collection("notifications")
        .add({
          title: "⚠️ High pH Alert!",
          message: `Warning: Your aquarium pH level is too high (${pHLevel})!`,
          createdAt: new Date().toISOString(),
          isRead: false,
        });

      return new Response(
        JSON.stringify({ status: "Notification sent and logged" }),
        { status: 200 }
      );
    }

    return new Response(
      JSON.stringify({ error: "Notification failed", details: notificationResult.error }),
      { status: 500 }
    );
  } catch (error) {
    console.error("❌ Internal Server Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal Server Error" }),
      { status: 500 }
    );
  }
});
