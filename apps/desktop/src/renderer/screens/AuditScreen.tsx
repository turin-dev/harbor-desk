import { History, Refresh } from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import type { AuditEvent } from "@harbor/contracts";
import { EmptyState } from "../components/EmptyState.js";
import { PageHeader } from "../components/PageHeader.js";
import { formatTime } from "../format.js";
import { useAudit, useCurrentUser } from "../state/queries.js";

const resultTone: Record<
  AuditEvent["result"],
  "success" | "error" | "warning"
> = {
  success: "success",
  failure: "error",
  denied: "warning",
};

export function AuditScreen() {
  const { data: user } = useCurrentUser();
  const isAdmin = user?.role === "admin";
  const query = useAudit(200);
  const rows = query.data ?? [];

  return (
    <Box sx={{ px: 4, py: 2 }}>
      <PageHeader
        eyebrow="Gateway / Audit"
        title="Audit log"
        description="Recent gateway actions with the actor, target host, resource, and outcome. The log lives in gateway memory for the current process only."
        actions={
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              startIcon={<Refresh />}
              onClick={() => void query.refetch()}
              disabled={!isAdmin || query.isFetching}
            >
              Refresh
            </Button>
          </Stack>
        }
      />
      {!isAdmin && (
        <Alert severity="info" sx={{ mb: 1.5 }}>
          Viewing the audit log requires the admin role. Sign in as an admin to
          inspect gateway actions.
        </Alert>
      )}
      {isAdmin && query.isError && (
        <Stack spacing={1.25}>
          <Typography color="error" sx={{ fontSize: 13 }}>
            Could not load the audit log from the gateway.
          </Typography>
          <Button
            color="error"
            variant="outlined"
            onClick={() => void query.refetch()}
          >
            Retry
          </Button>
        </Stack>
      )}
      {isAdmin &&
        !query.isError &&
        (query.isLoading ? (
          <Paper sx={{ overflow: "hidden" }}>
            <Stack alignItems="center" sx={{ py: 8 }}>
              <Typography color="text.secondary">
                Reading gateway audit log…
              </Typography>
            </Stack>
          </Paper>
        ) : rows.length ? (
          <Paper sx={{ overflow: "hidden" }}>
            <Table size="small" aria-label="Gateway audit log">
              <TableHead>
                <TableRow>
                  <TableCell>When</TableCell>
                  <TableCell>Actor</TableCell>
                  <TableCell>Host</TableCell>
                  <TableCell>Action</TableCell>
                  <TableCell>Resource</TableCell>
                  <TableCell align="right">Result</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} hover>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      {formatTime(row.occurredAt)}
                    </TableCell>
                    <TableCell sx={{ fontFamily: "monospace", fontSize: 12 }}>
                      {row.actorId}
                    </TableCell>
                    <TableCell>{row.hostId ?? "—"}</TableCell>
                    <TableCell sx={{ fontFamily: "monospace", fontSize: 12 }}>
                      {row.action}
                    </TableCell>
                    <TableCell sx={{ fontFamily: "monospace", fontSize: 12 }}>
                      {row.resourceKind
                        ? row.resourceId
                          ? row.resourceKind + ":" + row.resourceId
                          : row.resourceKind
                        : "—"}
                    </TableCell>
                    <TableCell align="right">
                      <Chip
                        size="small"
                        label={row.result}
                        color={resultTone[row.result]}
                        variant="outlined"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        ) : (
          <EmptyState
            title="No audit events yet"
            description="Gateway actions such as container runs, pulls, and prunes will appear here once they are captured."
            icon={<History />}
          />
        ))}
    </Box>
  );
}
