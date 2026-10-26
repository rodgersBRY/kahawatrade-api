import { ApiError } from "../../common/errors/ApiError.js";
import { withActor } from "../../db/pool.js";
import { AuthContext } from "../../types/auth.js";

export class TraceabilityService {
  async getLotTraceability(lotId: string, actor: AuthContext): Promise<unknown> {
    const lotResult = await withActor(
      actor,
      `
      SELECT
        l.*,
        s.name AS supplier,
        g.code AS grade,
        w.name AS warehouse,
        bt.name AS bag_type
      FROM lots l
      LEFT JOIN suppliers s ON s.id = l.supplier_id
      LEFT JOIN grades g ON g.id = l.grade_id
      LEFT JOIN warehouses w ON w.id = l.warehouse_id
      LEFT JOIN bag_types bt ON bt.id = l.bag_type_id
      WHERE l.id = $1 AND l.organization_id = $2
      `,
      [lotId, actor.organizationId],
    );
    if (lotResult.rowCount === 0) {
      throw new ApiError(404, `Lot not found`);
    }
    const lot = lotResult.rows[0];

    let procurement: Record<string, unknown> = {};
    if (String(lot.source) === "auction") {
      const auctionResult = await withActor(
        actor,
        `
        SELECT ap.*, s.name AS marketing_agent
        FROM auction_procurements ap
        LEFT JOIN suppliers s ON s.id = ap.marketing_agent_id
        WHERE ap.lot_id = $1 AND ap.organization_id = $2
        `,
        [lotId, actor.organizationId],
      );
      const auction = auctionResult.rows[0];
      procurement = {
        source: "auction",
        auction_lot_number: auction?.auction_lot_number ?? lot.source_reference,
        sale_number: auction?.sale_number ?? null,
        outturn_number: auction?.outturn_number ?? null,
        mark: auction?.mark ?? null,
        marketing_agent_id: auction?.marketing_agent_id ?? lot.supplier_id,
        marketing_agent: auction?.marketing_agent ?? lot.supplier ?? null,
        catalog_document_path: auction?.catalog_document_path ?? null,
      };
    } else {
      const deliveryResult = await withActor(
        actor,
        "SELECT * FROM direct_deliveries WHERE lot_id = $1 AND organization_id = $2",
        [lotId, actor.organizationId],
      );
      const delivery = deliveryResult.rows[0];
      const agreementResult = delivery
        ? await withActor(
            actor,
            "SELECT * FROM direct_agreements WHERE id = $1 AND organization_id = $2",
            [delivery.agreement_id, actor.organizationId],
          )
        : { rows: [] };
      const agreement = agreementResult.rows[0];
      procurement = {
        source: "direct",
        agreement_id: agreement?.id ?? null,
        agreement_reference: agreement?.agreement_reference ?? null,
        delivery_reference: delivery?.delivery_reference ?? lot.source_reference,
        quality_metrics: {
          moisture_percent: delivery?.moisture_percent ?? null,
          screen_size: delivery?.screen_size ?? null,
          defects_percent: delivery?.defects_percent ?? null,
        },
      };
    }

    const allocationsResult = await withActor(
      actor,
      `
      SELECT a.*, c.contract_number, sh.shipment_number
      FROM allocations a
      LEFT JOIN contracts c ON c.id = a.contract_id
      LEFT JOIN shipments sh ON sh.id = a.shipment_id
      WHERE a.lot_id = $1 AND a.organization_id = $2
      ORDER BY a.id
      `,
      [lotId, actor.organizationId],
    );
    const shipmentIds = Array.from(
      new Set(
        allocationsResult.rows
          .map((row: Record<string, unknown>) =>
            row.shipment_id ? String(row.shipment_id) : null,
          )
          .filter((id: string | null): id is string => id !== null),
      ),
    );
    const shipmentsResult =
      shipmentIds.length > 0
        ? await withActor(
            actor,
            `
            SELECT sh.*, c.contract_number
            FROM shipments sh
            LEFT JOIN contracts c ON c.id = sh.contract_id
            WHERE sh.id = ANY($1::uuid[]) AND sh.organization_id = $2
            ORDER BY sh.id
            `,
            [shipmentIds, actor.organizationId],
          )
        : { rows: [] };
    const docsResult =
      shipmentIds.length > 0
        ? await withActor(
            actor,
            `
            SELECT d.*, sh.shipment_number
            FROM shipment_documents d
            LEFT JOIN shipments sh ON sh.id = d.shipment_id
            WHERE d.shipment_id = ANY($1::uuid[]) AND d.organization_id = $2
            ORDER BY d.id
            `,
            [shipmentIds, actor.organizationId],
          )
        : { rows: [] };

    return {
      lot,
      procurement,
      allocations: allocationsResult.rows,
      shipments: shipmentsResult.rows,
      documents: docsResult.rows,
    };
  }

  async getReferenceData(actor: AuthContext): Promise<unknown> {
    const lotsResult = await withActor(
      actor,
      `
      SELECT id, lot_code, source, status, crop_year
      FROM lots
      WHERE organization_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 1000
      `,
      [actor.organizationId],
    );

    return {
      lots: lotsResult.rows,
    };
  }
}

export const traceabilityService = new TraceabilityService();
