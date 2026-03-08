import * as XLSX from 'xlsx';
import { extractArrivalDate, type ArrivalExtraction } from './arrival-date-extractor';

export interface ParsedShipment {
  goods_name: string;
  ship_date: string | null;
  cartons: number | null;
  shipping_method: string | null;
  destination_country: string | null;
  destination_detail: string | null;
  tracking_number: string | null;
  reference_number: string | null;
  tracking_url: string | null;
  vessel_name: string | null;
  status: string;
  etd: string | null;
  eta: string | null;
  notes: string | null;
  source_year: number | null;
  extracted_arrival: string | null;
  arrival_confidence: 'high' | 'low' | null;
  arrival_snippet: string | null;
}

const COLUMN_MAP: Record<string, string> = {
  'goods name': 'goods_name',
  'goods': 'goods_name',
  'product': 'goods_name',
  'item': 'goods_name',
  'date': 'ship_date',
  'ship date': 'ship_date',
  'cartons': 'cartons',
  'ctns': 'cartons',
  'shipping service': 'shipping_service',
  'shipping': 'shipping_service',
  'service': 'shipping_service',
  'tracking number': 'tracking_number',
  'tracking no': 'tracking_number',
  'tracking': 'tracking_number',
  'reference number': 'reference_number',
  'reference no': 'reference_number',
  'reference': 'reference_number',
  'ref': 'reference_number',
  'website': 'website',
  'url': 'website',
  'link': 'website',
  'situation': 'situation',
  'status': 'situation',
  'remark': 'situation',
  'remarks': 'situation',
  'note': 'situation',
  'notes': 'situation',
};

function normalizeHeader(header: string): string | null {
  const clean = header.toLowerCase().trim();
  return COLUMN_MAP[clean] || null;
}

function parseShippingService(service: string): { method: string | null; country: string | null; detail: string | null } {
  const s = service.toLowerCase().trim();
  let method: string | null = null;
  let country: string | null = null;
  let detail: string | null = null;

  if (s.includes('air')) method = 'air';
  else if (s.includes('sea')) method = 'sea';

  if (s.includes('to au')) country = 'AU';
  else if (s.includes('to uk')) country = 'UK';
  else if (s.includes('to us')) country = 'US';

  // Everything after the country marker is the detail
  const parts = service.split(/\s+/);
  const countryIdx = parts.findIndex(p => /^(au|uk|us)$/i.test(p));
  if (countryIdx >= 0 && countryIdx < parts.length - 1) {
    detail = parts.slice(countryIdx + 1).join(' ').trim();
  }

  // If no detail parsed from service, check for common patterns
  if (!detail) {
    const afterTo = service.match(/to\s+(?:au|uk|us)\s+(.*)/i);
    if (afterTo) detail = afterTo[1].trim();
  }

  return { method, country, detail: detail || null };
}

function parseSituation(situation: string): { vessel_name: string | null; etd: string | null; eta: string | null; status: string; notes: string } {
  let vessel_name: string | null = null;
  let etd: string | null = null;
  let eta: string | null = null;
  let status = 'waiting';
  const notes = situation;

  // Parse vessel name
  const vesselMatch = situation.match(/vessel\s*name\s*:\s*(\w+)/i);
  if (vesselMatch) vessel_name = vesselMatch[1];

  // Parse ETD/ETA dates - format like "ETD:2.4,ETA:2.16" or "ETD:2.4,ETD:2.16"
  const etdMatch = situation.match(/ETD\s*:\s*(\d+)\.(\d+)/i);
  if (etdMatch) {
    const month = parseInt(etdMatch[1]);
    const day = parseInt(etdMatch[2]);
    const year = new Date().getFullYear();
    etd = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  // Look for ETA (sometimes second ETD is actually ETA)
  const allDates = [...situation.matchAll(/(?:ETD|ETA)\s*:\s*(\d+)\.(\d+)/gi)];
  if (allDates.length >= 2) {
    const last = allDates[allDates.length - 1];
    const month = parseInt(last[1]);
    const day = parseInt(last[2]);
    const year = new Date().getFullYear();
    eta = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  // Determine status
  const lower = situation.toLowerCase();
  if (lower.includes('delivered') || lower.includes('arrived')) status = 'delivered';
  else if (lower.includes('in transit') || lower.includes('shipped') || vessel_name) status = 'in_transit';
  else status = 'waiting';

  return { vessel_name, etd, eta, status, notes };
}

function parseExcelDate(value: any): string | null {
  if (!value) return null;
  
  // If it's already a Date object (Excel parsed it)
  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }
  
  // If it's a number (Excel serial date)
  if (typeof value === 'number') {
    const date = new Date((value - 25569) * 86400 * 1000);
    return date.toISOString().split('T')[0];
  }
  
  // String date parsing - try common formats
  const str = String(value).trim();
  
  // DD/MM/YYYY or D/M/YYYY
  const dmyMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmyMatch) {
    return `${dmyMatch[3]}-${String(dmyMatch[2]).padStart(2, '0')}-${String(dmyMatch[1]).padStart(2, '0')}`;
  }
  
  // YYYY-MM-DD
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return str;
  
  return null;
}

function extractTrackingUrl(value: string, trackingNumber?: string | null): string | null {
  if (!value) return null;
  const urlMatch = value.match(/(https?:\/\/[^\s]+)/);
  if (!urlMatch) return null;
  let url = urlMatch[1];
  
  // For logisticsoa.com, append tracking number to the URL
  if (trackingNumber && url.includes('logisticsoa.com') && url.includes('#track')) {
    url = url.replace('#track', `#track=${trackingNumber}`);
  }
  
  return url;
}

function detectYearFromTabName(tabName: string): number | null {
  const yearMatch = tabName.match(/\b(20\d{2})\b/);
  return yearMatch ? parseInt(yearMatch[1]) : null;
}

export function generateShipmentFingerprint(s: Pick<ParsedShipment, 'goods_name' | 'ship_date' | 'tracking_number' | 'cartons' | 'destination_country' | 'shipping_method'>): string {
  const name = (s.goods_name || '').toLowerCase().trim();
  const date = (s.ship_date || '').trim();
  const tracking = (s.tracking_number || '').toLowerCase().trim();

  if (tracking) {
    return `${name}|${date}|${tracking}`;
  }
  // Fallback: use cartons + country + method
  const cartons = s.cartons ?? '';
  const country = (s.destination_country || '').toLowerCase().trim();
  const method = (s.shipping_method || '').toLowerCase().trim();
  return `${name}|${date}|${cartons}|${country}|${method}`;
}

export function parseLogisticsFile(file: File): Promise<ParsedShipment[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const allShipments: ParsedShipment[] = [];

        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
          
          if (rows.length === 0) continue;

          const sourceYear = detectYearFromTabName(sheetName);
          
          // Map headers
          const firstRow = rows[0] as Record<string, any>;
          const headerMapping: Record<string, string> = {};
          for (const key of Object.keys(firstRow)) {
            const mapped = normalizeHeader(key);
            if (mapped) headerMapping[key] = mapped;
          }

          for (const row of rows) {
            const r = row as Record<string, any>;
            const mapped: Record<string, any> = {};
            for (const [origKey, mappedKey] of Object.entries(headerMapping)) {
              mapped[mappedKey] = r[origKey];
            }

            // Skip rows without a goods name
            if (!mapped.goods_name || String(mapped.goods_name).trim() === '') continue;

            // Parse shipping service
            const shippingInfo = mapped.shipping_service 
              ? parseShippingService(String(mapped.shipping_service)) 
              : { method: null, country: null, detail: null };

            // Parse date early so we can use it for arrival extraction
            const shipDate = parseExcelDate(mapped.ship_date);

            // Parse situation
            const situationText = mapped.situation ? String(mapped.situation) : '';
            const situationInfo = situationText
              ? parseSituation(situationText) 
              : { vessel_name: null, etd: null, eta: null, status: 'waiting', notes: null };

            // Extract arrival date from situation text
            const arrivalInfo: ArrivalExtraction = situationText
              ? extractArrivalDate(situationText, sourceYear, shipDate)
              : { extracted_arrival: null, arrival_confidence: null, arrival_snippet: null };

            // If we found a high-confidence arrival, override status to delivered
            let finalStatus = situationInfo.status;
            if (arrivalInfo.extracted_arrival && arrivalInfo.arrival_confidence === 'high') {
              finalStatus = 'delivered';
            }

            // Parse tracking URL - pass tracking number for logisticsoa.com deep-linking
            const trackingNum = mapped.tracking_number ? String(mapped.tracking_number).trim() : null;
            const trackingUrl = mapped.website 
              ? extractTrackingUrl(String(mapped.website), trackingNum) 
              : null;

            // Detect year from date if not from tab
            let year = sourceYear;
            if (!year && shipDate) {
              year = parseInt(shipDate.substring(0, 4));
            }

            const shipment: ParsedShipment = {
              goods_name: String(mapped.goods_name).trim(),
              ship_date: shipDate,
              cartons: mapped.cartons ? parseInt(String(mapped.cartons)) || null : null,
              shipping_method: shippingInfo.method,
              destination_country: shippingInfo.country,
              destination_detail: shippingInfo.detail,
              tracking_number: mapped.tracking_number ? String(mapped.tracking_number).trim() || null : null,
              reference_number: mapped.reference_number ? String(mapped.reference_number).trim() || null : null,
              tracking_url: trackingUrl,
              vessel_name: situationInfo.vessel_name,
              status: finalStatus,
              etd: situationInfo.etd,
              eta: situationInfo.eta,
              notes: situationInfo.notes,
              source_year: year,
              extracted_arrival: arrivalInfo.extracted_arrival,
              arrival_confidence: arrivalInfo.arrival_confidence,
              arrival_snippet: arrivalInfo.arrival_snippet,
            };

            allShipments.push(shipment);
          }
        }

        resolve(allShipments);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}
