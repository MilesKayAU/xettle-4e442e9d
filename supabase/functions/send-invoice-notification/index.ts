import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface InvoiceNotificationRequest {
  to_email: string;
  invoice_id: string;
  supplier_name: string;
  order_id: string;
  amount: number;
  currency: string;
  invoice_type: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      to_email, 
      invoice_id, 
      supplier_name, 
      order_id, 
      amount, 
      currency,
      invoice_type 
    }: InvoiceNotificationRequest = await req.json();

    console.log("Sending invoice notification to:", to_email);
    console.log("Invoice details:", { invoice_id, supplier_name, order_id, amount, currency, invoice_type });

    if (!to_email) {
      throw new Error("No recipient email provided");
    }

    const formattedAmount = new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: currency || 'USD'
    }).format(amount || 0);

    const emailResponse = await resend.emails.send({
      from: "Invoice Notifications <onboarding@resend.dev>",
      to: [to_email],
      subject: `New Invoice Created - ${supplier_name || 'Unknown Supplier'} - Ready for Xero Sync`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #333; border-bottom: 2px solid #0066cc; padding-bottom: 10px;">
            New Invoice Created
          </h1>
          
          <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h2 style="color: #0066cc; margin-top: 0;">Invoice Details</h2>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Supplier:</td>
                <td style="padding: 8px 0;">${supplier_name || 'N/A'}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Order/PI ID:</td>
                <td style="padding: 8px 0;">${order_id || 'N/A'}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Invoice Type:</td>
                <td style="padding: 8px 0;">${invoice_type || 'N/A'}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Amount:</td>
                <td style="padding: 8px 0; font-size: 18px; color: #0066cc;">${formattedAmount}</td>
              </tr>
            </table>
          </div>
          
          <div style="background-color: #e6f3ff; padding: 15px; border-radius: 8px; border-left: 4px solid #0066cc;">
            <p style="margin: 0; color: #333;">
              <strong>Action Required:</strong> This invoice is ready to be synced to Xero.
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 25px;">
            <a href="https://www.mileskay.com.au" style="display: inline-block; background-color: #0066cc; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
              Go to MilesKay Dashboard
            </a>
          </div>
          
          <p style="color: #888; font-size: 12px; margin-top: 30px; border-top: 1px solid #ddd; padding-top: 15px;">
            This is an automated notification from your Alibaba Invoice Management System.<br>
            <a href="https://www.mileskay.com.au" style="color: #0066cc;">www.mileskay.com.au</a>
          </p>
        </div>
      `,
    });

    console.log("Email sent successfully:", emailResponse);

    return new Response(JSON.stringify({ success: true, data: emailResponse }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    console.error("Error in send-invoice-notification function:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
