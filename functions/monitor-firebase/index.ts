import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getDatabase } from "npm:firebase-admin@11.10.1/database";
import { initializeApp, cert } from "npm:firebase-admin@11.10.1/app";
import { ref, get, set } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-database.js";

// ✅ Firebase Realtime Database URL
const DATABASE_URL = "https://smartaquaria-9ad3b-default-rtdb.asia-southeast1.firebasedatabase.app";

// ✅ Supabase Setup
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ✅ Firebase Setup
const SERVICE_ACCOUNT_JSON = Deno.env.get("FIREBASE_SERVICE_ACCOUNT")!;
const SERVICE_ACCOUNT = JSON.parse(SERVICE_ACCOUNT_JSON);

const firebaseApp = initializeApp({
  credential: cert(SERVICE_ACCOUNT),
  databaseURL: DATABASE_URL, // ✅ FIXED: Added databaseURL
});
const db = getDatabase(firebaseApp);

let lastKnownData: Record<string, number> = {}; // Store last known pH levels

async function pollFirebase() {
  try {
    const devicesSnapshot = await get(ref(db, "devices"));
    const devices = devicesSnapshot.val() as Record<string, any>;

    if (!devices) return;

    for (const [deviceId, rawDeviceData] of Object.entries(devices)) {
      const deviceData = rawDeviceData as {
        data?: { phlevel?: { pHLevel?: number } };
        userId?: string;
      };

      if (!deviceData.data?.phlevel?.pHLevel || !deviceData.userId) continue;

      const pHLevel = deviceData.data.phlevel.pHLevel;
      const userId = deviceData.userId;

      // ✅ Check if pH level is high and if it has changed
      if (pHLevel > 8.5 && (!lastKnownData[deviceId] || lastKnownData[deviceId] !== pHLevel)) {
        console.log(`⚠️ High pH detected | User: ${userId}, Device: ${deviceId}, pH: ${pHLevel}`);

        // ✅ Store alert in Firebase
        await set(ref(db, `alerts/${deviceId}`), {
          userId,
          deviceId,
          pHLevel,
          timestamp: new Date().toISOString(),
          handled: false,
        });

        // ✅ Send notification via Supabase Function
        const notifyResponse = await fetch(
          "https://lhdhuonairkdxzpaaqpi.supabase.co/functions/v1/notification",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({ userId, deviceId, pHLevel }),
          }
        );

        if (!notifyResponse.ok) {
          console.error("❌ Notification failed:", await notifyResponse.text());
        } else {
          console.log("🔔 Notification Sent!");
        }
      }

      lastKnownData[deviceId] = pHLevel; // ✅ Update last known pH level
    }
  } catch (error) {
    console.error("❌ Error polling Firebase:", error);
  }
}

// ✅ Poll Firebase every 10 seconds
setInterval(pollFirebase, 10000);

// ✅ Start HTTP server
serve(() => new Response("Polling active 🚀", { status: 200 }));
