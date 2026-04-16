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
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[9998] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden animate-in">
        {/* Content */}
        <div className="px-8 py-12 text-center space-y-6">
          {/* Icon */}
          <div className="flex justify-center">
            <div className="relative">
              <div className="w-24 h-24 rounded-full bg-emerald-100 flex items-center justify-center animate-bounce-subtle">
                <div className="w-20 h-20 rounded-full bg-emerald-50 flex items-center justify-center">
                  <CheckCircle size={56} className="text-emerald-500" />
                </div>
              </div>
            </div>
          </div>

          {/* Title */}
          <h1 className="text-2xl font-bold text-text tracking-tight">{title}</h1>

          {/* Message */}
          <p className="text-sm text-secondary leading-relaxed">{message}</p>

          {/* Button */}
          <Button size="lg" className="w-full justify-center mt-8" onClick={onContinue}>
            {buttonText}
          </Button>
        </div>
      </div>
    </div>
  );
}
