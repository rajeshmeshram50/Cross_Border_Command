import { Card, CardBody } from '../components/ui/Card';
import { Users } from 'lucide-react';

export default function UsersPage() {
  return (
    <div>
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <Users size={16} className="text-primary" />
          </div>
          <div>
            <h1 className="text-[17px] font-bold text-text tracking-tight">Users</h1>
            <p className="text-[11.5px] text-muted mt-0.5">User management</p>
          </div>
        </div>
      </div>

      <Card>
        <CardBody>
          <div className="text-center py-8 text-muted text-[13px]">
            User management coming soon.
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
