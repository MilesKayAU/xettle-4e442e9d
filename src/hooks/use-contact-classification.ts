import { supabase } from '@/integrations/supabase/client';

interface CommunitySuggestion {
  classification: string;
  category: string | null;
  confidence_pct: number;
  vote_count: number;
}

export function useContactClassification() {
  const getClassification = async (contactName: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('user_contact_classifications')
      .select('classification, category, notes, xero_contact_id')
      .eq('user_id', user.id)
      .eq('contact_name', contactName)
      .maybeSingle();

    if (error) {
      console.error('[useContactClassification] getClassification failed:', error.message);
      return null;
    }

    return data;
  };

  const getCommunitySuggestion = async (contactName: string): Promise<CommunitySuggestion | null> => {
    const { data, error } = await supabase
      .from('community_contact_classifications')
      .select('classification, category, confidence_pct, vote_count')
      .eq('contact_name', contactName.toLowerCase().trim())
      .order('vote_count', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[useContactClassification] getCommunitySuggestion failed:', error.message);
      return null;
    }

    if (!data || (data.vote_count ?? 0) < 3) return null;

    return {
      classification: data.classification,
      category: data.category,
      confidence_pct: data.confidence_pct ?? 0,
      vote_count: data.vote_count ?? 0,
    };
  };

  const saveClassification = async (
    contactName: string,
    classification: string,
    category: string | null,
    xeroContactId?: string | null,
  ) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { error } = await supabase
      .from('user_contact_classifications')
      .upsert({
        user_id: user.id,
        contact_name: contactName,
        classification,
        category,
        xero_contact_id: xeroContactId || null,
        notes: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,contact_name' });

    if (error) throw error;
  };

  return { getClassification, getCommunitySuggestion, saveClassification };
}
