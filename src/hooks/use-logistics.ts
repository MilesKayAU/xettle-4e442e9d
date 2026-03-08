import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { type ParsedShipment, generateShipmentFingerprint } from '@/utils/logistics-parser';
import { extractArrivalDate } from '@/utils/arrival-date-extractor';
import type { ReviewItem } from '@/components/admin/ArrivalDateReviewDialog';

export interface LogisticsShipment {
  id: string;
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
  actual_arrival: string | null;
  amazon_clearance_date: string | null;
  notes: string | null;
  source_year: number | null;
  upload_batch_id: string | null;
  user_id: string | null;
  created_at: string;
  updated_at: string;
}

export function useLogistics() {
  const [shipments, setShipments] = useState<LogisticsShipment[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchShipments = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('logistics_shipments')
        .select('*')
        .order('ship_date', { ascending: false });

      if (error) throw error;
      setShipments(data || []);
    } catch (err: any) {
      toast.error('Failed to load shipments: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const uploadShipments = useCallback(async (parsed: ParsedShipment[]): Promise<{
    count: number;
    reviewItems: Array<{ shipment_id: string; goods_name: string; suggested_date: string; snippet: string; ship_date: string | null }>;
  }> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Fetch existing shipments to deduplicate
      const { data: existing } = await (supabase as any)
        .from('logistics_shipments')
        .select('goods_name, ship_date, tracking_number, cartons, destination_country, shipping_method');

      const existingFingerprints = new Set(
        (existing || []).map((s: any) => generateShipmentFingerprint(s))
      );

      const newRows = parsed.filter(
        s => !existingFingerprints.has(generateShipmentFingerprint(s))
      );

      const skipped = parsed.length - newRows.length;

      if (newRows.length === 0) {
        toast.info(`All ${parsed.length} rows already exist — nothing new to upload`);
        return { count: 0, reviewItems: [] };
      }

      const batchId = crypto.randomUUID();
      const records = newRows.map(s => {
        const record: any = {
          goods_name: s.goods_name,
          ship_date: s.ship_date,
          cartons: s.cartons,
          shipping_method: s.shipping_method,
          destination_country: s.destination_country,
          destination_detail: s.destination_detail,
          tracking_number: s.tracking_number,
          reference_number: s.reference_number,
          tracking_url: s.tracking_url,
          vessel_name: s.vessel_name,
          status: s.status,
          etd: s.etd,
          eta: s.eta,
          notes: s.notes,
          source_year: s.source_year,
          user_id: user.id,
          upload_batch_id: batchId,
        };
        // Auto-set actual_arrival for high-confidence extractions
        if (s.extracted_arrival && s.arrival_confidence === 'high') {
          record.actual_arrival = s.extracted_arrival;
        }
        return record;
      });

      const { data: inserted, error } = await (supabase as any)
        .from('logistics_shipments')
        .insert(records)
        .select('id, goods_name, ship_date');

      if (error) throw error;

      // Build review items for low-confidence extractions
      const reviewItems: Array<{ shipment_id: string; goods_name: string; suggested_date: string; snippet: string; ship_date: string | null }> = [];
      const insertedData = inserted || [];
      
      // Match inserted records back to parsed rows for low-confidence items
      newRows.forEach((s, idx) => {
        if (s.extracted_arrival && s.arrival_confidence === 'low' && insertedData[idx]) {
          reviewItems.push({
            shipment_id: insertedData[idx].id,
            goods_name: s.goods_name,
            suggested_date: s.extracted_arrival,
            snippet: s.arrival_snippet || '',
            ship_date: s.ship_date,
          });
        }
      });

      const highCount = newRows.filter(s => s.arrival_confidence === 'high').length;
      let msg = `Uploaded ${records.length} new shipments`;
      if (skipped > 0) msg += ` (${skipped} duplicates skipped)`;
      if (highCount > 0) msg += `. ${highCount} arrival date${highCount !== 1 ? 's' : ''} auto-detected.`;
      if (reviewItems.length > 0) msg += ` ${reviewItems.length} need review.`;
      toast.success(msg);

      await fetchShipments();
      return { count: records.length, reviewItems };
    } catch (err: any) {
      toast.error('Upload failed: ' + err.message);
      return { count: 0, reviewItems: [] };
    }
  }, [fetchShipments]);

  const updateShipment = useCallback(async (id: string, updates: Partial<LogisticsShipment>) => {
    try {
      const { error } = await (supabase as any)
        .from('logistics_shipments')
        .update(updates)
        .eq('id', id);

      if (error) throw error;
      toast.success('Shipment updated');
      await fetchShipments();
    } catch (err: any) {
      toast.error('Update failed: ' + err.message);
    }
  }, [fetchShipments]);

  const deleteShipment = useCallback(async (id: string) => {
    try {
      const { error } = await (supabase as any)
        .from('logistics_shipments')
        .delete()
        .eq('id', id);

      if (error) throw error;
      toast.success('Shipment deleted');
      await fetchShipments();
    } catch (err: any) {
      toast.error('Delete failed: ' + err.message);
    }
  }, [fetchShipments]);

  const deleteBatch = useCallback(async (batchId: string) => {
    try {
      const { error } = await (supabase as any)
        .from('logistics_shipments')
        .delete()
        .eq('upload_batch_id', batchId);

      if (error) throw error;
      toast.success('Batch deleted');
      await fetchShipments();
    } catch (err: any) {
      toast.error('Delete failed: ' + err.message);
    }
  }, [fetchShipments]);

  const bulkUpdateStatus = useCallback(async (ids: string[], status: string, arrivalDate?: string) => {
    try {
      const updates: Partial<LogisticsShipment> = { status };
      if (arrivalDate) updates.actual_arrival = arrivalDate;

      const { error } = await (supabase as any)
        .from('logistics_shipments')
        .update(updates)
        .in('id', ids);

      if (error) throw error;
      toast.success(`Updated ${ids.length} shipments`);
      await fetchShipments();
    } catch (err: any) {
      toast.error('Bulk update failed: ' + err.message);
    }
  }, [fetchShipments]);

  const rescanArrivalDates = useCallback(async (): Promise<{
    autoApplied: number;
    reviewItems: ReviewItem[];
  }> => {
    // Scan pending shipments (no arrival yet) AND delivered shipments with impossible dates
    const pending = shipments.filter(
      s => s.status !== 'delivered' && !s.actual_arrival && s.notes && s.notes.trim() !== ''
    );

    // Also find delivered shipments with bad dates (actual_arrival before ship_date)
    const badDates = shipments.filter(s => {
      if (!s.actual_arrival || !s.ship_date || !s.notes) return false;
      return new Date(s.actual_arrival).getTime() < new Date(s.ship_date).getTime();
    });

    const toScan = [...pending, ...badDates];

    if (toScan.length === 0) {
      toast.info('No shipments to scan');
      return { autoApplied: 0, reviewItems: [] };
    }

    const highConfidence: Array<{ id: string; date: string }> = [];
    const lowConfidence: ReviewItem[] = [];

    for (const s of toScan) {
      const result = extractArrivalDate(s.notes!, s.source_year, s.ship_date);
      if (!result.extracted_arrival) continue;

      if (result.arrival_confidence === 'high') {
        highConfidence.push({ id: s.id, date: result.extracted_arrival });
      } else if (result.arrival_confidence === 'low') {
        lowConfidence.push({
          shipment_id: s.id,
          goods_name: s.goods_name,
          suggested_date: result.extracted_arrival,
          snippet: result.arrival_snippet || '',
          ship_date: s.ship_date,
        });
      }
    }

    // Batch update high-confidence matches
    if (highConfidence.length > 0) {
      for (const { id, date } of highConfidence) {
        await (supabase as any)
          .from('logistics_shipments')
          .update({ actual_arrival: date, status: 'delivered' })
          .eq('id', id);
      }
    }

    await fetchShipments();

    const total = highConfidence.length + lowConfidence.length;
    const badFixed = badDates.length > 0 ? ` (incl. ${badDates.length} corrected)` : '';
    let msg = `Scanned ${toScan.length} shipments${badFixed}. Found ${total} arrival date${total !== 1 ? 's' : ''}`;
    if (highConfidence.length > 0) msg += `: ${highConfidence.length} auto-applied`;
    if (lowConfidence.length > 0) msg += `, ${lowConfidence.length} need review`;
    toast.success(msg);

    return { autoApplied: highConfidence.length, reviewItems: lowConfidence };
  }, [shipments, fetchShipments]);

  const deduplicateShipments = useCallback(async (): Promise<number> => {
    try {
      // Group shipments by fingerprint, keep the oldest (earliest created_at)
      const fingerprints = new Map<string, LogisticsShipment[]>();
      for (const s of shipments) {
        const fp = generateShipmentFingerprint({
          goods_name: s.goods_name,
          ship_date: s.ship_date,
          tracking_number: s.tracking_number,
          cartons: s.cartons,
          destination_country: s.destination_country,
          shipping_method: s.shipping_method,
        });
        if (!fingerprints.has(fp)) fingerprints.set(fp, []);
        fingerprints.get(fp)!.push(s);
      }

      const idsToDelete: string[] = [];
      for (const group of fingerprints.values()) {
        if (group.length <= 1) continue;
        // Sort by created_at ascending, keep the first one (oldest)
        group.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        // If any in the group has actual_arrival/delivered status, prefer keeping that one
        const deliveredIdx = group.findIndex(s => s.status === 'delivered' || s.actual_arrival);
        const keepIdx = deliveredIdx >= 0 ? deliveredIdx : 0;
        for (let i = 0; i < group.length; i++) {
          if (i !== keepIdx) idsToDelete.push(group[i].id);
        }
      }

      if (idsToDelete.length === 0) {
        toast.info('No duplicate shipments found');
        return 0;
      }

      // Delete in batches of 50
      for (let i = 0; i < idsToDelete.length; i += 50) {
        const batch = idsToDelete.slice(i, i + 50);
        const { error } = await (supabase as any)
          .from('logistics_shipments')
          .delete()
          .in('id', batch);
        if (error) throw error;
      }

      toast.success(`Removed ${idsToDelete.length} duplicate shipments`);
      await fetchShipments();
      return idsToDelete.length;
    } catch (err: any) {
      toast.error('Deduplication failed: ' + err.message);
      return 0;
    }
  }, [shipments, fetchShipments]);

  return { shipments, loading, fetchShipments, uploadShipments, updateShipment, deleteShipment, deleteBatch, bulkUpdateStatus, rescanArrivalDates, deduplicateShipments };
}
