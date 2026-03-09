import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background">
      <nav className="fixed top-0 w-full bg-background/80 backdrop-blur-md border-b border-border z-50">
        <div className="container-custom flex items-center justify-between h-16">
          <Link to="/" className="text-xl font-bold tracking-tight">
            <span className="text-primary">Xe</span><span className="text-foreground">ttle</span>
          </Link>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/"><ArrowLeft className="mr-2 h-4 w-4" /> Back</Link>
          </Button>
        </div>
      </nav>

      <div className="container-custom max-w-3xl mx-auto pt-28 pb-16 px-4">
        <h1 className="text-4xl font-bold text-foreground mb-2">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-10">Last updated: {new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}</p>

        <div className="prose prose-sm max-w-none text-foreground space-y-6">
          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">1. Who We Are</h2>
            <p className="text-muted-foreground leading-relaxed">Xettle ("we", "us", "our") operates the xettle.app website and service. We are an Australian-based software service that helps Amazon sellers synchronise settlement data with Xero accounting software.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">2. Information We Collect</h2>
            <p className="text-muted-foreground leading-relaxed mb-3">We collect information you provide directly:</p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1">
              <li>Account information (email address, name) when you register</li>
              <li>Xero OAuth tokens when you connect your Xero organisation</li>
              <li>Amazon settlement report data that you upload</li>
              <li>Usage data and application logs</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">3. How We Use Your Information</h2>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1">
              <li>To provide and maintain the Xettle service</li>
              <li>To authenticate your Xero connection and sync settlement data</li>
              <li>To communicate with you about the service</li>
              <li>To detect and prevent fraud or abuse</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">4. Data Storage and Security</h2>
            <p className="text-muted-foreground leading-relaxed">Your data is stored securely using industry-standard encryption. Xero OAuth tokens are encrypted at rest and isolated per user. We do not store your Xero login credentials. Settlement data you upload is processed and stored in your account only.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">5. Third-Party Services</h2>
            <p className="text-muted-foreground leading-relaxed mb-3">We integrate with the following third-party services:</p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1">
              <li><strong>Xero</strong> — for accounting data synchronisation (governed by Xero's privacy policy)</li>
              <li><strong>Supabase</strong> — for authentication and data storage infrastructure</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mt-3">We do not sell your personal information to third parties.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">6. Your Rights</h2>
            <p className="text-muted-foreground leading-relaxed">Under the Australian Privacy Act 1988, you have the right to access, correct, and request deletion of your personal information. You can disconnect your Xero account and delete your Xettle account at any time. To exercise these rights, contact us at hello@xettle.app.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">7. Cookies</h2>
            <p className="text-muted-foreground leading-relaxed">We use essential cookies for authentication and session management. We do not use advertising or tracking cookies.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">8. Changes to This Policy</h2>
            <p className="text-muted-foreground leading-relaxed">We may update this Privacy Policy from time to time. We will notify you of any material changes by posting the new policy on this page and updating the "Last updated" date.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">9. Contact Us</h2>
            <p className="text-muted-foreground leading-relaxed">If you have any questions about this Privacy Policy, please contact us at <a href="mailto:hello@xettle.app" className="text-primary hover:underline">hello@xettle.app</a>.</p>
          </section>
        </div>
      </div>

      <footer className="border-t border-border py-6 px-4">
        <div className="container-custom text-center">
          <p className="text-xs text-muted-foreground/60">Xero is a trademark of Xero Limited. Xettle is not affiliated with Xero Limited.</p>
        </div>
      </footer>
    </div>
  );
}
