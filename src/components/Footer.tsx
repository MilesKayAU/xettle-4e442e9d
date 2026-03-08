
import { Link } from 'react-router-dom';
import { Instagram, Twitter, Facebook } from 'lucide-react';
import { useState } from 'react';
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

const Footer = () => {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleNewsletterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes('@')) {
      toast({
        title: "Invalid Email",
        description: "Please enter a valid email address.",
        variant: "destructive"
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('newsletter_subscribers')
        .insert({
          email: email,
          full_name: '' // Added to match the insert type
        });

      if (error) {
        console.error('Error submitting newsletter:', error);
        throw error;
      }

      toast({
        title: "Subscription Successful",
        description: "Thank you for subscribing to our newsletter!",
      });
      setEmail('');
    } catch (error) {
      console.error('Error in newsletter submission:', error);
      toast({
        title: "Subscription Failed",
        description: "There was an error subscribing to the newsletter. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <footer className="bg-white border-t pt-16 pb-8">
      <div className="container-custom">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-12">
          <div>
            <h3 className="text-xl font-heading font-semibold mb-6">Miles Kay</h3>
            <p className="text-muted text-sm leading-relaxed mb-4">Innovative cleaning solutions for a cleaner, more sustainable future.</p>
            <div className="flex space-x-4 mt-4">
              <a href="#" className="text-muted hover:text-primary transition-colors">
                <Instagram className="w-5 h-5" />
              </a>
              <a href="#" className="text-muted hover:text-primary transition-colors">
                <Twitter className="w-5 h-5" />
              </a>
              <a href="#" className="text-muted hover:text-primary transition-colors">
                <Facebook className="w-5 h-5" />
              </a>
            </div>
          </div>
          
          <div>
            <h4 className="text-base font-heading font-semibold mb-6">Quick Links</h4>
            <ul className="space-y-3">
              <li><Link to="/products" className="text-muted text-sm hover:text-primary transition-colors">Products</Link></li>
              <li><Link to="/where-to-buy" className="text-muted text-sm hover:text-primary transition-colors">Where to Buy</Link></li>
              <li><Link to="/distributors" className="text-muted text-sm hover:text-primary transition-colors">Become a Distributor</Link></li>
              
            </ul>
          </div>
          
          <div>
            <h4 className="text-base font-heading font-semibold mb-6">Purchase Options</h4>
            <ul className="space-y-3">
              <li><a href="https://www.mileskayaustralia.com" target="_blank" rel="noopener noreferrer" className="text-muted text-sm hover:text-primary transition-colors">Miles Kay Australia</a></li>
              <li><a href="https://www.amazon.com.au/s?srs=24307900051" target="_blank" rel="noopener noreferrer" className="text-muted text-sm hover:text-primary transition-colors">Amazon AU</a></li>
              <li><a href="https://www.mileskay.co.uk" target="_blank" rel="noopener noreferrer" className="text-muted text-sm hover:text-primary transition-colors">Miles Kay UK</a></li>
              <li><a href="https://www.amazon.com/s?srs=120823107011" target="_blank" rel="noopener noreferrer" className="text-muted text-sm hover:text-primary transition-colors">Amazon USA</a></li>
            </ul>
          </div>
          
          <div>
            <h4 className="text-base font-heading font-semibold mb-6">Newsletter</h4>
            <p className="text-muted text-sm mb-4">Subscribe to receive updates on new products and promotions.</p>
            <form onSubmit={handleNewsletterSubmit} className="flex">
              <input 
                type="email" 
                placeholder="Your email" 
                className="bg-secondary px-4 py-2 rounded-l-lg text-sm flex-1 focus:outline-none"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isSubmitting}
              />
              <button 
                type="submit"
                className="bg-primary hover:bg-primary-dark text-white px-4 py-2 rounded-r-lg transition-all duration-200 text-sm disabled:opacity-70"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Sending...' : 'Subscribe'}
              </button>
            </form>
          </div>
        </div>
        
        <div className="border-t border-gray-100 pt-8">
          <p className="text-center text-muted text-sm">&copy; {new Date().getFullYear()} Miles Kay. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
