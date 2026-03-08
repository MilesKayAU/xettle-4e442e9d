import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Default entity details (fallback if no custom settings configured)
const DEFAULT_ENTITY_DETAILS = {
  Australia: {
    name: 'MilesKay Australia Pty Ltd',
    address: 'Gold Coast, Queensland, Australia',
    email: 'orders@mileskay.com.au',
    amazon_store: 'Amazon Australia (amazon.com.au)',
    alibaba_buyer_email: '',
    alibaba_buyer_company: 'MilesKay Australia Pty Ltd',
    alibaba_buyer_id: '',
  },
  UK: {
    name: 'MilesKay UK Ltd',
    address: 'London, United Kingdom',
    email: 'orders@mileskay.co.uk',
    amazon_store: 'Amazon UK (amazon.co.uk)',
    alibaba_buyer_email: '',
    alibaba_buyer_company: 'MilesKay UK Ltd',
    alibaba_buyer_id: '',
  },
  USA: {
    name: 'MilesKay USA LLC',
    address: 'Delaware, United States',
    email: 'orders@mileskay.com',
    amazon_store: 'Amazon USA (amazon.com)',
    alibaba_buyer_email: '',
    alibaba_buyer_company: 'MilesKay USA LLC',
    alibaba_buyer_id: '',
  },
};

interface SendPORequest {
  purchaseOrderId: string;
  supplierEmail: string;
  customMessage?: string;
}

interface LineItem {
  sku: string;
  title: string;
  quantity: number;
  unit_price: number;
  total: number;
}

interface AlibabaAccountDetails {
  alibaba_buyer_email: string;
  alibaba_buyer_company: string;
  alibaba_buyer_id: string;
  additional_instructions?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { purchaseOrderId, supplierEmail, customMessage }: SendPORequest = await req.json();

    // Fetch the purchase order
    const { data: po, error: poError } = await supabase
      .from('purchase_orders')
      .select(`
        *,
        supplier:suppliers(name, company_name, contact_person, email)
      `)
      .eq('id', purchaseOrderId)
      .single();

    if (poError || !po) {
      throw new Error('Purchase order not found');
    }

    const country = po.country as keyof typeof DEFAULT_ENTITY_DETAILS;
    const defaultEntity = DEFAULT_ENTITY_DETAILS[country] || DEFAULT_ENTITY_DETAILS.Australia;

    // Fetch Alibaba account settings from app_settings
    const { data: accountSetting } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', `alibaba_account_${country}`)
      .single();

    let alibabaDetails: AlibabaAccountDetails = {
      alibaba_buyer_email: defaultEntity.alibaba_buyer_email,
      alibaba_buyer_company: defaultEntity.alibaba_buyer_company,
      alibaba_buyer_id: defaultEntity.alibaba_buyer_id,
    };

    if (accountSetting?.value) {
      try {
        const parsed = JSON.parse(accountSetting.value);
        alibabaDetails = {
          alibaba_buyer_email: parsed.alibaba_buyer_email || defaultEntity.alibaba_buyer_email,
          alibaba_buyer_company: parsed.alibaba_buyer_company || defaultEntity.alibaba_buyer_company,
          alibaba_buyer_id: parsed.alibaba_buyer_id || defaultEntity.alibaba_buyer_id,
          additional_instructions: parsed.additional_instructions,
        };
      } catch (e) {
        console.error('Failed to parse Alibaba account settings:', e);
      }
    }

    const entity = {
      ...defaultEntity,
      ...alibabaDetails,
    };

    const lineItems = (po.line_items as LineItem[]) || [];
    const approvalUrl = `${req.headers.get('origin') || 'https://miles-kay-reveal.lovable.app'}/po-approval/${po.approval_token}`;

    // Generate line items HTML
    const lineItemsHtml = lineItems.map(item => `
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; font-family: monospace;">${item.sku}</td>
        <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${item.title}</td>
        <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">${item.quantity.toLocaleString()}</td>
        <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">${po.currency} ${item.unit_price.toFixed(2)}</td>
        <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: bold;">${po.currency} ${item.total.toFixed(2)}</td>
      </tr>
    `).join('');

    // Check if Alibaba account is configured
    const isAlibabaConfigured = entity.alibaba_buyer_email && entity.alibaba_buyer_email.includes('@');
    const alibabaWarning = !isAlibabaConfigured ? `
      <div style="margin-top: 16px; padding: 12px; background: #fef2f2; border-radius: 8px; border: 1px solid #fecaca;">
        <p style="margin: 0; color: #991b1b; font-size: 14px;">
          <strong>⚠️ WARNING:</strong> Alibaba account details have not been configured. Please contact the buyer for correct account details before creating the Trade Assurance order.
        </p>
      </div>
    ` : '';

    const additionalInstructions = alibabaDetails.additional_instructions ? `
      <div style="margin-top: 12px; padding: 12px; background: #fff7ed; border-radius: 8px; border: 1px solid #fed7aa;">
        <p style="margin: 0; color: #9a3412; font-size: 14px;">
          <strong>Additional Instructions:</strong> ${alibabaDetails.additional_instructions}
        </p>
      </div>
    ` : '';

    const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 700px; margin: 0 auto; padding: 20px;">
      
      <!-- Header -->
      <div style="background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">Purchase Order</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 18px;">${po.po_number}</p>
      </div>
      
      <!-- CRITICAL: ALIBABA TRADE ASSURANCE INSTRUCTIONS -->
      <div style="background: #dc2626; padding: 24px; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">
        <table style="width: 100%; background: white; border-radius: 12px; overflow: hidden;">
          <tr>
            <td style="padding: 24px;">
              <p style="margin: 0 0 12px 0; color: #dc2626; font-weight: bold; font-size: 16px; text-transform: uppercase;">
                🚨 ALIBABA PAYMENT (TRADE ASSURANCE) – CREATE ORDER TO THIS BUYER ACCOUNT
              </p>
              <table style="width: 100%; margin-top: 12px;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">
                    <span style="color: #6b7280; font-size: 14px;">Alibaba Registered Email:</span><br>
                    <strong style="font-size: 18px; color: #1f2937;">${entity.alibaba_buyer_email || '(Not configured)'}</strong>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">
                    <span style="color: #6b7280; font-size: 14px;">Buyer/Company Name on Alibaba:</span><br>
                    <strong style="font-size: 18px; color: #1f2937;">${entity.alibaba_buyer_company || '(Not configured)'}</strong>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;">
                    <span style="color: #6b7280; font-size: 14px;">Alibaba Member/Buyer ID:</span><br>
                    <strong style="font-size: 18px; color: #1f2937;">${entity.alibaba_buyer_id || '(Not configured)'}</strong>
                  </td>
                </tr>
              </table>
              <div style="margin-top: 16px; padding: 12px; background: #fef2f2; border-radius: 8px; border: 1px solid #fecaca;">
                <p style="margin: 0; color: #991b1b; font-size: 14px;">
                  <strong>⚠️ INSTRUCTION:</strong> Please create the Trade Assurance order addressed to the buyer account above and send the payment request inside that Alibaba thread/account. DO NOT send to any other account.
                </p>
              </div>
              ${alibabaWarning}
              ${additionalInstructions}
            </td>
            <td style="text-align: center; vertical-align: top; padding: 24px; width: 100px;">
              <span style="display: inline-block; background: ${po.country === 'Australia' ? '#22c55e' : po.country === 'UK' ? '#3b82f6' : '#f59e0b'}; color: white; padding: 12px 16px; border-radius: 8px; font-size: 24px; font-weight: bold;">
                ${po.country === 'Australia' ? '🇦🇺' : po.country === 'UK' ? '🇬🇧' : '🇺🇸'}
              </span>
              <p style="margin: 8px 0 0 0; font-weight: bold; color: #1f2937;">${po.country}</p>
            </td>
          </tr>
        </table>
      </div>
      
      <!-- Billing Entity Info -->
      <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 20px; border-right: 1px solid #e5e7eb;">
        <table style="width: 100%;">
          <tr>
            <td>
              <p style="margin: 0 0 8px 0; color: #b45309; font-weight: bold; font-size: 14px;">INVOICE TO:</p>
              <p style="margin: 0 0 4px 0; font-size: 18px; font-weight: bold; color: #1f2937;">${entity.name}</p>
              <p style="margin: 0; color: #78350f; font-size: 14px;">
                ${entity.address}<br>
                For: <strong>${entity.amazon_store}</strong>
              </p>
            </td>
          </tr>
        </table>
      </div>
      
      <!-- Entity Info -->
      <div style="background: #f8fafc; padding: 20px; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">
        <table style="width: 100%;">
          <tr>
            <td>
              <strong style="color: #3b82f6;">${entity.name}</strong><br>
              <span style="color: #6b7280; font-size: 14px;">${entity.address}</span><br>
              <span style="color: #6b7280; font-size: 14px;">${entity.email}</span>
            </td>
          </tr>
        </table>
      </div>
      
      <!-- Greeting -->
      <div style="padding: 24px; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">
        <p style="margin: 0 0 16px 0;">Dear ${po.supplier?.contact_person || 'Supplier'},</p>
        <p style="margin: 0 0 16px 0;">Please review the following purchase order from ${entity.name}.</p>
        ${customMessage ? `<p style="margin: 0 0 16px 0; padding: 12px; background: #e0f2fe; border-radius: 8px;"><strong>Note:</strong> ${customMessage}</p>` : ''}
      </div>
      
      <!-- Order Details -->
      <div style="padding: 0 24px 24px 24px; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">
        <table style="width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <thead>
            <tr style="background: #f1f5f9;">
              <th style="padding: 12px; text-align: left; font-size: 14px; color: #64748b;">SKU</th>
              <th style="padding: 12px; text-align: left; font-size: 14px; color: #64748b;">Description</th>
              <th style="padding: 12px; text-align: right; font-size: 14px; color: #64748b;">Qty</th>
              <th style="padding: 12px; text-align: right; font-size: 14px; color: #64748b;">Unit Price</th>
              <th style="padding: 12px; text-align: right; font-size: 14px; color: #64748b;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${lineItemsHtml}
          </tbody>
          <tfoot>
            <tr style="background: #f8fafc;">
              <td colspan="4" style="padding: 16px; text-align: right; font-weight: bold; font-size: 16px;">Total Amount:</td>
              <td style="padding: 16px; text-align: right; font-weight: bold; font-size: 18px; color: #3b82f6;">${po.currency} ${(po.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      
      ${po.terms ? `
      <div style="padding: 0 24px 24px 24px; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">
        <p style="margin: 0; color: #6b7280; font-size: 14px;"><strong>Terms:</strong> ${po.terms}</p>
      </div>
      ` : ''}
      
      <!-- CTA Button -->
      <div style="padding: 32px; text-align: center; background: #f8fafc; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">
        <p style="margin: 0 0 20px 0; color: #4b5563;">Please review and confirm this order by clicking the button below:</p>
        <a href="${approvalUrl}" style="display: inline-block; background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); color: white; padding: 16px 48px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 6px rgba(34, 197, 94, 0.3);">
          ✓ Review & Approve Order
        </a>
        <p style="margin: 20px 0 0 0; color: #9ca3af; font-size: 12px;">By approving, you confirm the order will be invoiced to <strong>${entity.name}</strong></p>
      </div>
      
      <!-- Footer -->
      <div style="padding: 24px; text-align: center; background: #1f2937; border-radius: 0 0 12px 12px; color: #9ca3af; font-size: 14px;">
        <p style="margin: 0 0 8px 0;">If you have any questions, please reply to this email.</p>
        <p style="margin: 0;">Best regards,<br><strong style="color: white;">${entity.name}</strong></p>
      </div>
      
    </body>
    </html>
    `;

    // Send email via Resend
    const emailResponse = await resend.emails.send({
      from: `${entity.name} <onboarding@resend.dev>`,
      to: [supplierEmail],
      subject: `Purchase Order ${po.po_number} from ${entity.name} - Invoice to ${entity.name}`,
      html: emailHtml,
    });

    console.log("Email sent successfully:", emailResponse);

    return new Response(JSON.stringify({ success: true, emailResponse }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error sending PO email:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
