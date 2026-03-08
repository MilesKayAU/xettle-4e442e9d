import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NotificationPayload {
  po_id: string;
  action: "approved" | "rejected";
  approver_name: string;
  approver_email: string;
  alibaba_order_id?: string;
  supplier_notes?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload: NotificationPayload = await req.json();
    console.log("Notification payload received:", payload);

    const { po_id, action, approver_name, approver_email, alibaba_order_id, supplier_notes } = payload;

    if (!po_id || !action || !approver_name || !approver_email) {
      console.error("Missing required fields");
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase client with service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch PO details
    const { data: po, error: poError } = await supabase
      .from("purchase_orders")
      .select(`
        *,
        supplier:suppliers(name, email)
      `)
      .eq("id", po_id)
      .single();

    if (poError || !po) {
      console.error("Error fetching PO:", poError);
      return new Response(
        JSON.stringify({ error: "Purchase order not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("PO fetched:", po.po_number);

    // Get admin notification email from settings
    const { data: settings } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "notification_email")
      .single();

    const adminEmail = settings?.value || "admin@example.com";
    console.log("Admin email:", adminEmail);

    // Get Resend API key
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.error("RESEND_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "Email service not configured", details: "RESEND_API_KEY missing" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Format currency
    const formatCurrency = (amount: number | null, currency: string = "USD") => {
      if (!amount) return "N/A";
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: currency,
      }).format(amount);
    };

    // Entity mapping
    const entityMap: Record<string, string> = {
      "Australia": "MilesKay Australia Pty Ltd",
      "United Kingdom": "MilesKay UK Ltd",
      "United States": "MilesKay US Inc",
    };

    const entity = entityMap[po.country] || po.country;
    const actionText = action === "approved" ? "APPROVED" : "REJECTED";
    const actionColor = action === "approved" ? "#22c55e" : "#ef4444";
    const approvalDate = new Date().toLocaleString("en-AU", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "Australia/Brisbane",
    });

    // Build email HTML
    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5;">
  <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
    
    <!-- Header -->
    <div style="background: ${actionColor}; color: white; padding: 24px; text-align: center;">
      <h1 style="margin: 0; font-size: 24px;">Purchase Order ${actionText}</h1>
      <p style="margin: 8px 0 0 0; opacity: 0.9; font-size: 18px;">${po.po_number}</p>
    </div>
    
    <!-- Content -->
    <div style="padding: 24px;">
      
      <!-- Approval Info Box -->
      <div style="background: ${action === "approved" ? "#f0fdf4" : "#fef2f2"}; border-left: 4px solid ${actionColor}; padding: 16px; margin-bottom: 24px; border-radius: 0 8px 8px 0;">
        <h3 style="margin: 0 0 12px 0; color: #333;">Supplier Response</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 4px 0; color: #666; width: 120px;">Name:</td>
            <td style="padding: 4px 0; font-weight: 600;">${approver_name}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #666;">Email:</td>
            <td style="padding: 4px 0;">${approver_email}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #666;">Date:</td>
            <td style="padding: 4px 0;">${approvalDate}</td>
          </tr>
        </table>
      </div>
      
      ${alibaba_order_id ? `
      <!-- Alibaba Order ID -->
      <div style="background: #eff6ff; border: 1px solid #bfdbfe; padding: 16px; margin-bottom: 24px; border-radius: 8px;">
        <h4 style="margin: 0 0 8px 0; color: #1e40af;">Alibaba Order ID Provided</h4>
        <p style="margin: 0; font-family: monospace; font-size: 16px; color: #1e40af; font-weight: 600;">${alibaba_order_id}</p>
      </div>
      ` : ""}
      
      ${supplier_notes ? `
      <!-- Supplier Notes -->
      <div style="background: #fafafa; padding: 16px; margin-bottom: 24px; border-radius: 8px; border: 1px solid #e5e5e5;">
        <h4 style="margin: 0 0 8px 0; color: #333;">Supplier Notes</h4>
        <p style="margin: 0; color: #555; line-height: 1.5;">${supplier_notes}</p>
      </div>
      ` : ""}
      
      <!-- PO Details -->
      <div style="border-top: 1px solid #e5e5e5; padding-top: 24px;">
        <h3 style="margin: 0 0 16px 0; color: #333;">Purchase Order Details</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #666; border-bottom: 1px solid #f0f0f0;">Entity:</td>
            <td style="padding: 8px 0; font-weight: 500; border-bottom: 1px solid #f0f0f0;">${entity}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666; border-bottom: 1px solid #f0f0f0;">Supplier:</td>
            <td style="padding: 8px 0; font-weight: 500; border-bottom: 1px solid #f0f0f0;">${po.supplier?.name || "N/A"}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666; border-bottom: 1px solid #f0f0f0;">Total Amount:</td>
            <td style="padding: 8px 0; font-weight: 600; font-size: 18px; color: #333; border-bottom: 1px solid #f0f0f0;">${formatCurrency(po.total_amount, po.currency)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666;">Created:</td>
            <td style="padding: 8px 0;">${new Date(po.created_at).toLocaleDateString("en-AU", { dateStyle: "long" })}</td>
          </tr>
        </table>
      </div>
      
      <!-- Action Button -->
      <div style="text-align: center; margin-top: 32px;">
        <a href="https://miles-kay-reveal.lovable.app/admin" style="display: inline-block; background: #333; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">
          View in Admin Dashboard
        </a>
      </div>
      
    </div>
    
    <!-- Footer -->
    <div style="background: #f9fafb; padding: 16px 24px; text-align: center; color: #666; font-size: 12px;">
      <p style="margin: 0;">This is an automated notification from the MilesKay Purchase Order System.</p>
    </div>
    
  </div>
</body>
</html>
    `;

    // Send email via Resend
    console.log("Sending notification email via Resend...");
    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: "PO Notifications <onboarding@resend.dev>",
        to: [adminEmail],
        subject: `[${actionText}] ${po.po_number} - ${po.supplier?.name || "Supplier"}`,
        html: emailHtml,
      }),
    });

    const resendResult = await resendResponse.json();
    console.log("Resend response:", resendResult);

    if (!resendResponse.ok) {
      console.error("Resend API error:", resendResult);
      return new Response(
        JSON.stringify({ 
          error: "Failed to send email", 
          details: resendResult 
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Notification email sent successfully");

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Notification sent to ${adminEmail}`,
        email_id: resendResult.id 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in notify-po-approval:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
