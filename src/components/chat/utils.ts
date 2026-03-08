
import { FAQ } from './types';

export const checkForDistributorKeywords = (text: string): boolean => {
  const distributorKeywords = [
    'distributor', 'distribute', 'wholesale', 'wholesaler', 
    'bulk', 'resell', 'reseller', 'business', 'store', 
    'shop', 'retailer', 'distribute', 'supplier', 'supply',
    'partner', 'partnership', 'b2b', 'pallet', 'pallets'
  ];
  
  return distributorKeywords.some(keyword => 
    text.toLowerCase().includes(keyword)
  );
};

export const findMatchingFaq = (userInput: string, faqs: FAQ[]): FAQ | null => {
  if (!faqs || faqs.length === 0) return null;
  
  const normalizedInput = userInput.toLowerCase().trim();
  
  for (const faq of faqs) {
    const normalizedQuestion = faq.question.toLowerCase().trim();
    
    if (normalizedInput === normalizedQuestion) {
      return faq;
    }
    
    if (normalizedInput.includes(normalizedQuestion)) {
      return faq;
    }
    
    if (normalizedQuestion.includes(normalizedInput) && normalizedInput.length > 5) {
      return faq;
    }
  }
  
  return null;
};
