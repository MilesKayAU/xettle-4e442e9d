export interface PurchaseOrderLineItem {
  sku: string;
  title: string;
  quantity: number;
  unit_price: number;
  total: number;
  urgency_level?: string;
  notes?: string;
}

export interface PurchaseOrder {
  id: string;
  user_id: string;
  supplier_id: string | null;
  po_number: string;
  country: 'Australia' | 'UK' | 'USA';
  status: 'draft' | 'sent' | 'approved' | 'rejected' | 'completed';
  total_amount: number | null;
  currency: string;
  notes: string | null;
  terms: string | null;
  line_items: PurchaseOrderLineItem[];
  approval_token: string;
  approved_at: string | null;
  approved_by_name: string | null;
  approved_by_email: string | null;
  supplier_notes: string | null;
  alibaba_order_id: string | null;
  alibaba_order_uuid: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  expires_at: string | null;
  // Payment tracking fields
  payment_status?: 'pending' | 'verified' | 'paid';
  payment_verified_at?: string | null;
  payment_verified_by?: string | null;
  payment_notes?: string | null;
}

export interface PurchaseOrderWithSupplier extends PurchaseOrder {
  supplier?: {
    id: string;
    name: string;
    company_name?: string;
    contact_person?: string;
    email?: string;
    phone?: string;
  } | null;
}

export interface CreatePurchaseOrderInput {
  supplier_id: string | null;
  supplier_name: string;
  country: 'Australia' | 'UK' | 'USA';
  currency: string;
  notes?: string;
  terms?: string;
  line_items: PurchaseOrderLineItem[];
}

export const ENTITY_DETAILS = {
  Australia: {
    name: 'MilesKay Australia Pty Ltd',
    address: 'Gold Coast, Queensland, Australia',
    email: 'orders@mileskay.com.au',
    currency: 'USD',
    billing_instructions: 'Invoice to: MilesKay Australia Pty Ltd',
    amazon_store: 'Amazon Australia (amazon.com.au)',
    // ALIBABA TRADE ASSURANCE DETAILS - UPDATE THESE WITH REAL VALUES
    alibaba_buyer_email: 'REPLACE_WITH_AU_ALIBABA_EMAIL@example.com',
    alibaba_buyer_company: 'MilesKay Australia Pty Ltd',
    alibaba_buyer_id: 'AU_BUYER_ID_HERE',
  },
  UK: {
    name: 'MilesKay UK Ltd',
    address: 'London, United Kingdom',
    email: 'orders@mileskay.co.uk',
    currency: 'GBP',
    billing_instructions: 'Invoice to: MilesKay UK Ltd',
    amazon_store: 'Amazon UK (amazon.co.uk)',
    // ALIBABA TRADE ASSURANCE DETAILS - UPDATE THESE WITH REAL VALUES
    alibaba_buyer_email: 'REPLACE_WITH_UK_ALIBABA_EMAIL@example.com',
    alibaba_buyer_company: 'MilesKay UK Ltd',
    alibaba_buyer_id: 'UK_BUYER_ID_HERE',
  },
  USA: {
    name: 'MilesKay USA LLC',
    address: 'Delaware, United States',
    email: 'orders@mileskay.com',
    currency: 'USD',
    billing_instructions: 'Invoice to: MilesKay USA LLC',
    amazon_store: 'Amazon USA (amazon.com)',
    // ALIBABA TRADE ASSURANCE DETAILS - UPDATE THESE WITH REAL VALUES
    alibaba_buyer_email: 'REPLACE_WITH_USA_ALIBABA_EMAIL@example.com',
    alibaba_buyer_company: 'MilesKay USA LLC',
    alibaba_buyer_id: 'USA_BUYER_ID_HERE',
  },
} as const;
