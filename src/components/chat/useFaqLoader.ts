
import { useState, useEffect } from 'react';
import { FAQ } from './types';

export const useFaqLoader = () => {
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    // Only load FAQs once when component mounts
    if (!isLoaded) {
      try {
        const storedFaqs = localStorage.getItem('faqs');
        if (storedFaqs) {
          const parsedFaqs = JSON.parse(storedFaqs);
          setFaqs(parsedFaqs);
          console.log("FAQs loaded from localStorage:", parsedFaqs.length);
        }
      } catch (error) {
        console.error("Error loading FAQs:", error);
      } finally {
        setIsLoaded(true);
      }
    }
  }, [isLoaded]);

  return { faqs, isLoaded };
};
