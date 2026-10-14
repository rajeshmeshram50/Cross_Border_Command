import { CheckCircle } from 'lucide-react';
import Button from '../ui/Button';
interface SuccessModalProps {
  title?: string;
  message?: string;
  buttonText?: string;
  onContinue: () => void;
}

export default function SuccessModal({ 
  title = 'Successful', 
  message = 'Your action has been completed successfully.',
  buttonText = 'Continue',
  onContinue 
}: SuccessModalProps) {
  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" />
      {/* Sized to its content. It was max-w-md with px-8 py-12, space-y-6, a
          96px icon ring and an extra mt-8 under the button — roughly 420px of
          card for one short sentence, which read as a dialog waiting for
          something more to be said. The measurements below are the same card
          at the same proportions, just not oversized: max-w-sm and rounded-2xl
          also match the organisation-picker popup on this screen. */}
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden animate-in">
        {/* Content */}
        <div className="px-6 py-7 text-center space-y-4">
          {/* Icon */}
          <div className="flex justify-center">
            <div className="relative">
              <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center animate-bounce-subtle">
                <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center">
                  <CheckCircle size={30} className="text-emerald-500" />
                </div>
              </div>
            </div>
          </div>

          {/* Title */}
          <h1 className="text-lg font-bold text-text tracking-tight">{title}</h1>

          {/* Message */}
          <p className="text-[13px] text-secondary leading-relaxed">{message}</p>

          {/* Button — the mt-8 is gone; space-y-4 already sets this gap, and
              the two together stacked 56px under a two-line message. */}
          <Button size="lg" className="w-full justify-center" onClick={onContinue}>
            {buttonText}
          </Button>
        </div>
      </div>
    </div>
  );
}
