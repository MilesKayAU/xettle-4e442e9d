
export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LeadInfo {
  name: string;
  email: string;
  region: string;
  company?: string;
  isDistributor: boolean;
}

export interface FAQ {
  id: number;
  question: string;
  answer: string;
}
