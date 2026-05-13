import { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Plus } from 'lucide-react';
import { inventoryService } from '../../services';
import type { BinLocation, BinStockLevel, Warehouse } from '../../types/inventory';
import BinMoveModal from './BinMoveModal';

export default function LocationsTab() {
  const queryClient = useQueryClient();
  const [warehouseId, setWarehouseId] = useState('');
  const [zoneForm, setZoneForm] = useState({ code: '', name: '' });
  const [binForm, setBinForm] = useState({ code: '', zoneId: '', binType: 'PICK' });
  const [moveFromBin, setMoveFromBin] = useState<BinLocation | null>(null);

  const { data: warehouses = [] } = useQuery<Warehouse[]>({ queryKey: ['inventory', 'warehouses'], queryFn: inventoryService.warehouses });
  const selectedWarehouseId = warehouseId || warehouses[0]?.id || '';
  const { data: zones = [] } = useQuery({
    queryKey: ['inventory', 'zones', selectedWarehouseId],
    queryFn: () => inventoryService.zones(selectedWarehouseId),
    enabled: Boolean(selectedWarehouseId),
  });
  const { data: bins = [], isLoading } = useQuery<BinLocation[]>({
    queryKey: ['inventory', 'bins', selectedWarehouseId],
    queryFn: () => inventoryService.bins({ warehouseId: selectedWarehouseId }),
    enabled: Boolean(selectedWarehouseId),
  });
  const { data: binStock = [] } = useQuery<BinStockLevel[]>({
    queryKey: ['inventory', 'bin-stock', selectedWarehouseId],
    queryFn: () => inventoryService.binStockLevels({ warehouseId: selectedWarehouseId }),
    enabled: Boolean(selectedWarehouseId),
  });

  const stockByBin = useMemo(() => {
    const counts = new Map<string, number>();
    binStock.forEach((row) => counts.set(row.binId, (counts.get(row.binId) ?? 0) + row.onHand));
    return counts;
  }, [binStock]);

  const createZone = useMutation({
    mutationFn: () => inventoryService.createZone(selectedWarehouseId, zoneForm),
    onSuccess: () => {
      setZoneForm({ code: '', name: '' });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'zones', selectedWarehouseId] });
    },
  });

  const createBin = useMutation({
    mutationFn: () => inventoryService.createBin({ warehouseId: selectedWarehouseId, ...binForm, zoneId: binForm.zoneId || null }),
    onSuccess: () => {
      setBinForm({ code: '', zoneId: '', binType: 'PICK' });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'bins', selectedWarehouseId] });
    },
  });

  const submitZone = (event: FormEvent) => {
    event.preventDefault();
    createZone.mutate();
  };

  const submitBin = (event: FormEvent) => {
    event.preventDefault();
    createBin.mutate();
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <div className="rounded-xl border border-slate-100 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold text-slate-800">Warehouse Locations</h3>
            <p className="text-sm text-slate-500">Zones, bins, barcodes, and bin-level stock.</p>
          </div>
          <select value={selectedWarehouseId} onChange={(event) => setWarehouseId(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500">
            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50">{['Bin', 'Zone', 'Type', 'Barcode', 'On Hand', 'Status', ''].map((heading) => <th key={heading} className="px-5 py-3 text-left font-medium text-slate-500">{heading}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? <tr><td colSpan={7} className="px-5 py-8 text-center text-slate-500">Loading bins...</td></tr> : bins.length === 0 ? <tr><td colSpan={7} className="px-5 py-8 text-center text-slate-500">No bins yet.</td></tr> : bins.map((bin) => (
                <tr key={bin.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-mono text-xs text-slate-600">{bin.code}</td>
                  <td className="px-5 py-3 text-slate-600">{bin.zone?.code ?? '—'}</td>
                  <td className="px-5 py-3 text-slate-600">{bin.binType}</td>
                  <td className="px-5 py-3 text-slate-500">{bin.barcode ?? '—'}</td>
                  <td className="px-5 py-3 font-medium text-slate-800">{stockByBin.get(bin.id) ?? 0}</td>
                  <td className="px-5 py-3"><span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Active</span></td>
                  <td className="px-5 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setMoveFromBin(bin)}
                      disabled={(stockByBin.get(bin.id) ?? 0) === 0}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                      title="Move stock to another bin"
                    >
                      <ArrowRightLeft size={13} /> Move
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-4">
        <form onSubmit={submitZone} className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm">
          <h4 className="mb-4 font-semibold text-slate-800">Add Zone</h4>
          <div className="space-y-3">
            <input required value={zoneForm.code} onChange={(event) => setZoneForm((current) => ({ ...current, code: event.target.value }))} placeholder="Zone code" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500" />
            <input required value={zoneForm.name} onChange={(event) => setZoneForm((current) => ({ ...current, name: event.target.value }))} placeholder="Zone name" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500" />
            <button disabled={!selectedWarehouseId || createZone.isPending} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"><Plus size={15} />Create Zone</button>
          </div>
        </form>

        <form onSubmit={submitBin} className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm">
          <h4 className="mb-4 font-semibold text-slate-800">Add Bin</h4>
          <div className="space-y-3">
            <input required value={binForm.code} onChange={(event) => setBinForm((current) => ({ ...current, code: event.target.value }))} placeholder="Bin code" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500" />
            <select value={binForm.zoneId} onChange={(event) => setBinForm((current) => ({ ...current, zoneId: event.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500">
              <option value="">No zone</option>
              {zones.map((zone: { id: string; code: string; name: string }) => <option key={zone.id} value={zone.id}>{zone.code} · {zone.name}</option>)}
            </select>
            <select value={binForm.binType} onChange={(event) => setBinForm((current) => ({ ...current, binType: event.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500">
              {['PICK', 'BULK', 'RECEIVING', 'QA', 'DAMAGED', 'RETURNS'].map((type) => <option key={type}>{type}</option>)}
            </select>
            <button disabled={!selectedWarehouseId || createBin.isPending} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"><Plus size={15} />Create Bin</button>
          </div>
        </form>
      </div>
      {moveFromBin ? (
        <BinMoveModal
          warehouseId={selectedWarehouseId}
          fromBin={moveFromBin}
          bins={bins}
          onClose={() => setMoveFromBin(null)}
        />
      ) : null}
    </div>
  );
}
