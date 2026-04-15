import StatCard from '../components/StatCard';
import { IndianRupee, Receipt, Clock, XCircle } from 'lucide-react';
import { Card, CardBody } from '../components/ui/Card';

export default function Payments() {
  return (
    <div>
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 className="text-[17px] font-bold text-text tracking-tight">Revenue & Payment History</h1>
          <p className="text-[11.5px] text-muted mt-0.5">Track all billing and subscription cycles</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <StatCard icon={IndianRupee} color="green" label="Total Revenue" value="₹0" />
        <StatCard icon={Receipt} color="blue" label="Transactions" value={0} />
        <StatCard icon={Clock} color="amber" label="Expired" value={0} />
        <StatCard icon={XCircle} color="red" label="Failed" value={0} />
      </div>

      <Card>
        <CardBody>
          <div className="text-center py-8 text-muted text-[13px]">
            No payment transactions yet. Payments will appear here when clients subscribe to plans.
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
