import { useQuery } from '@tanstack/react-query';
import { supplierService } from '../services';

export default function SuppliersPage() {
  const { data: suppliers = [], isLoading } = useQuery({
    queryKey: ['suppliers'],
    queryFn: supplierService.list,
  });

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-slate-800">Suppliers</h2>
        <p className="text-slate-500 text-sm">{suppliers.length} active suppliers</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50">
              {['Code', 'Name', 'Country', 'Lead Time', 'Payment Terms', 'Currency', 'Status'].map((h) => (
                <th key={h} className="text-left px-5 py-3 text-slate-500 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading
              ? Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-5 py-3">
                        <div className="h-4 bg-slate-100 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              : (suppliers as { id: string; code: string; name: string; country: string; leadTimeDays?: number; paymentTermsDays?: number; currency?: string; isActive?: boolean }[]).map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 font-mono text-xs text-slate-500">{s.code}</td>
                    <td className="px-5 py-3 font-medium text-slate-800">{s.name}</td>
                    <td className="px-5 py-3 text-slate-600">{s.country}</td>
                    <td className="px-5 py-3 text-slate-600">{s.leadTimeDays ?? '—'} days</td>
                    <td className="px-5 py-3 text-slate-600">{s.paymentTermsDays ?? '—'} days</td>
                    <td className="px-5 py-3 text-slate-600">{s.currency ?? 'USD'}</td>
                    <td className="px-5 py-3">
                      {s.isActive !== false ? (
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">Active</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600">Inactive</span>
                      )}
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
