
import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X, ShieldCheck } from 'lucide-react';

const Header = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const location = useLocation();
  
  // Close menu when route changes
  useEffect(() => {
    setIsMenuOpen(false);
  }, [location.pathname]);

  return (
    <header className="fixed w-full bg-white shadow-sm z-50">
      <div className="container mx-auto px-4 py-4">
        <nav className="flex items-center justify-between">
          <Link to="/" className="text-2xl font-bold text-primary">
            Miles Kay
          </Link>
          
          <button 
            className="md:hidden"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            aria-label={isMenuOpen ? "Close menu" : "Open menu"}
          >
            {isMenuOpen ? <X /> : <Menu />}
          </button>

          <div className={`${isMenuOpen ? 'block' : 'hidden'} md:block absolute md:relative top-full left-0 w-full md:w-auto bg-white md:bg-transparent shadow-md md:shadow-none`}>
            <ul className="flex flex-col md:flex-row space-y-4 md:space-y-0 md:space-x-8 p-4 md:p-0">
              <li><Link to="/products" className={`text-secondary-foreground hover:text-primary transition-colors ${location.pathname === '/products' ? 'font-medium text-primary' : ''}`}>Products</Link></li>
              <li><Link to="/where-to-buy" className={`text-secondary-foreground hover:text-primary transition-colors ${location.pathname === '/where-to-buy' ? 'font-medium text-primary' : ''}`}>Where to Buy</Link></li>
              <li><Link to="/distributors" className={`text-secondary-foreground hover:text-primary transition-colors ${location.pathname === '/distributors' ? 'font-medium text-primary' : ''}`}>Become a Distributor</Link></li>
              
              <li><Link to="/contact" className={`text-secondary-foreground hover:text-primary transition-colors ${location.pathname === '/contact' ? 'font-medium text-primary' : ''}`}>Contact</Link></li>
              <li><Link to="/admin" className={`flex items-center text-secondary-foreground hover:text-primary transition-colors ${location.pathname === '/admin' ? 'font-medium text-primary' : ''}`}><ShieldCheck className="mr-1 h-4 w-4" />Admin</Link></li>
            </ul>
          </div>
        </nav>
      </div>
    </header>
  );
};

export default Header;
