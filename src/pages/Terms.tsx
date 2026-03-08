import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Terms() {
  return (
    <div className="min-h-screen bg-background">
      <nav className="fixed top-0 w-full bg-background/80 backdrop-blur-md border-b border-border z-50">
        <div className="container-custom flex items-center justify-between h-16">
          <Link to="/" className="text-xl font-bold text-foreground tracking-tight">
            <span className="text-primary">X</span>ettle
          </Link>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/"><ArrowLeft className="mr-2 h-4 w-4" /> Back</Link>
          </Button>
        </div>
      </nav>

      <div className="container-custom max-w-3xl mx-auto pt-28 pb-16 px-4">
        <h1 className="text-4xl font-bold text-foreground mb-2">Terms of Service</h1>
        <p className="text-sm text-muted-foreground mb-10">Last updated: {new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}</p>

        <div className="prose prose-sm max-w-none text-foreground space-y-6">
          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">1. Acceptance of Terms</h2>
            <p className="text-muted-foreground leading-relaxed">By accessing or using Xettle ("the Service"), you agree to be bound by these Terms of Service. If you do not agree to these terms, you must not use the Service.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">2. Description of Service</h2>
            <p className="text-muted-foreground leading-relaxed">Xettle is a web-based tool that helps Amazon marketplace sellers parse settlement reports and synchronise the resulting accounting data with Xero. The Service is currently provided free of charge.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">3. User Accounts</h2>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1">
              <li>You must provide accurate and complete registration information</li>
              <li>You are responsible for maintaining the security of your account credentials</li>
              <li>You must notify us immediately of any unauthorised use of your account</li>
              <li>You must be at least 18 years old to use the Service</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">4. Xero Integration</h2>
            <p className="text-muted-foreground leading-relaxed">By connecting your Xero account, you authorise Xettle to access your Xero organisation to create invoices and related accounting entries on your behalf. You can revoke this access at any time through your Xero account settings or by disconnecting within Xettle.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">5. Your Responsibilities</h2>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1">
              <li>You are responsible for reviewing all settlement data before syncing to Xero</li>
              <li>You are responsible for the accuracy of your accounting records</li>
              <li>Xettle is a tool to assist with bookkeeping — it is not a substitute for professional accounting advice</li>
              <li>You must comply with all applicable Australian tax laws and regulations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">6. Limitation of Liability</h2>
            <p className="text-muted-foreground leading-relaxed">To the maximum extent permitted by Australian law, Xettle shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including but not limited to loss of profits, data, or business opportunities arising from your use of the Service. Xettle is not responsible for errors in settlement parsing or Xero synchronisation — you must review all entries before confirming.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">7. Disclaimer of Warranties</h2>
            <p className="text-muted-foreground leading-relaxed">The Service is provided "as is" and "as available" without warranties of any kind, either express or implied, including but not limited to implied warranties of merchantability, fitness for a particular purpose, or non-infringement.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">8. Modifications to Service</h2>
            <p className="text-muted-foreground leading-relaxed">We reserve the right to modify, suspend, or discontinue the Service at any time, with or without notice. We may also introduce paid features or tiers in the future, with reasonable notice to existing users.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">9. Termination</h2>
            <p className="text-muted-foreground leading-relaxed">We may terminate or suspend your account at our sole discretion, without prior notice, for conduct that we believe violates these Terms or is harmful to other users or the Service. You may delete your account at any time.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">10. Governing Law</h2>
            <p className="text-muted-foreground leading-relaxed">These Terms shall be governed by and construed in accordance with the laws of Australia. Any disputes arising from these Terms shall be subject to the exclusive jurisdiction of the courts of Australia.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">11. Intellectual Property</h2>
            <p className="text-muted-foreground leading-relaxed">Xettle and its original content, features, and functionality are owned by Xettle and are protected by international copyright, trademark, and other intellectual property laws. Xero is a trademark of Xero Limited. Amazon is a trademark of Amazon.com, Inc.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">12. Contact Us</h2>
            <p className="text-muted-foreground leading-relaxed">If you have any questions about these Terms, please contact us at <a href="mailto:hello@xettle.app" className="text-primary hover:underline">hello@xettle.app</a>.</p>
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
