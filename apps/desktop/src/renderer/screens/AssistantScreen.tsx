import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { PlayArrow } from "@mui/icons-material";
import type { AssistantProposal } from "@harbor/contracts";
import { PageHeader } from "../components/PageHeader.js";
import { formatTime } from "../format.js";
import {
  useAssistantAnalyze,
  useAssistantApply,
  useHosts,
} from "../state/queries.js";
import { useUiStore } from "../state/ui-store.js";

const severityColor: Record<string, "default" | "info" | "warning" | "error"> =
  {
    info: "info",
    warning: "warning",
    critical: "error",
  };

const riskColor: Record<
  AssistantProposal["risk"],
  "default" | "warning" | "error"
> = {
  low: "default",
  medium: "warning",
  high: "error",
};

export function AssistantScreen() {
  const { data: hosts = [] } = useHosts();
  const selectedHostId =
    useUiStore((state) => state.selectedHostId) ?? hosts[0]?.id;
  const host = hosts.find((item) => item.id === selectedHostId);
  const showToast = useUiStore((state) => state.showToast);
  const [analyzed, setAnalyzed] = useState(false);
  const analysis = useAssistantAnalyze(analyzed ? selectedHostId : undefined);
  const apply = useAssistantApply(selectedHostId);
  const [confirmTarget, setConfirmTarget] = useState<AssistantProposal>();

  const insights = analysis.data?.insights ?? [];
  const proposals = analysis.data?.proposals ?? [];

  const runAnalysis = () => {
    if (!host) return;
    if (analyzed) {
      void analysis.refetch();
    } else {
      setAnalyzed(true);
    }
  };

  const applyProposal = (proposal: AssistantProposal) => {
    apply.mutate(
      {
        resourceKind: proposal.resourceKind,
        resourceId: proposal.resourceId,
        action: proposal.action,
      },
      {
        onSuccess: () =>
          showToast(
            "Applied " + proposal.action + " to " + proposal.resourceId + ".",
            "success",
          ),
        onError: (error) =>
          showToast(
            error instanceof Error
              ? error.message
              : "The action could not be applied.",
            "error",
          ),
      },
    );
  };

  return (
    <Box sx={{ px: 4, py: 2 }}>
      <PageHeader
        eyebrow="Gateway / Assistant"
        title="Assistant"
        description="Deterministic, rule-based analysis of the selected host. The gateway inspects container state, images, volumes, and networks, then proposes safe operations. No LLM provider is required and every action is audited."
        actions={
          host ? (
            <Button
              variant="contained"
              startIcon={<PlayArrow />}
              onClick={runAnalysis}
              disabled={analysis.isFetching}
            >
              {analyzed ? "Re-analyze" : "Analyze host"}
            </Button>
          ) : undefined
        }
      />
      {!host ? (
        <Paper sx={{ p: 3 }}>
          <Typography sx={{ fontWeight: 650 }}>No host selected</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.35, maxWidth: 700 }}>
            Register a host and select it to run the assistant analysis.
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={1.5}>
          {analysis.isError && (
            <Alert
              severity="error"
              action={
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => void analysis.refetch()}
                >
                  Retry
                </Button>
              }
            >
              {(analysis.error as Error).message}
            </Alert>
          )}
          {analyzed && analysis.isFetching && !analysis.data && (
            <Paper sx={{ p: 3 }}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <CircularProgress size={20} />
                <Typography color="text.secondary">
                  Analyzing {host.displayName}…
                </Typography>
              </Stack>
            </Paper>
          )}
          {analysis.data && (
            <>
              <Typography color="text.secondary" sx={{ fontSize: 12 }}>
                Generated {formatTime(analysis.data.generatedAt)} for{" "}
                {host.displayName}
              </Typography>
              <Paper sx={{ p: 2 }}>
                <Typography sx={{ fontWeight: 700, mb: 1.25 }}>
                  Insights ({insights.length})
                </Typography>
                {insights.length === 0 ? (
                  <Typography color="text.secondary" sx={{ fontSize: 13 }}>
                    No issues detected. Containers, images, volumes, and
                    networks look healthy.
                  </Typography>
                ) : (
                  <Stack spacing={1.25}>
                    {insights.map((insight) => (
                      <Stack
                        key={insight.id}
                        direction="row"
                        spacing={1.25}
                        alignItems="flex-start"
                      >
                        <Chip
                          size="small"
                          label={insight.severity}
                          color={severityColor[insight.severity] ?? "default"}
                          sx={{ mt: 0.2, textTransform: "capitalize" }}
                        />
                        <Box sx={{ minWidth: 0 }}>
                          <Typography sx={{ fontWeight: 620, fontSize: 13.5 }}>
                            {insight.title}
                          </Typography>
                          <Typography
                            color="text.secondary"
                            sx={{ fontSize: 12.5 }}
                          >
                            {insight.detail}
                          </Typography>
                          {insight.resourceKind && (
                            <Typography
                              sx={{
                                fontSize: 11.5,
                                fontFamily: "monospace",
                                mt: 0.25,
                              }}
                            >
                              {insight.resourceKind} / {insight.resourceId}
                            </Typography>
                          )}
                        </Box>
                      </Stack>
                    ))}
                  </Stack>
                )}
              </Paper>
              <Paper sx={{ overflow: "hidden" }}>
                <Box sx={{ px: 2, pt: 2 }}>
                  <Typography sx={{ fontWeight: 700 }}>
                    Proposed actions ({proposals.length})
                  </Typography>
                </Box>
                <Table
                  size="small"
                  aria-label="Assistant proposals"
                  sx={{ mt: 1.25 }}
                >
                  <TableHead>
                    <TableRow>
                      <TableCell>Proposal</TableCell>
                      <TableCell>Target</TableCell>
                      <TableCell>Action</TableCell>
                      <TableCell>Risk</TableCell>
                      <TableCell>Reversible</TableCell>
                      <TableCell align="right">Apply</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {proposals.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6}>
                          <Typography
                            color="text.secondary"
                            sx={{ px: 0.5, py: 1 }}
                          >
                            No actions proposed.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                    {proposals.map((proposal) => (
                      <TableRow key={proposal.id} hover>
                        <TableCell>
                          <Stack spacing={0.35}>
                            <Typography sx={{ fontWeight: 620, fontSize: 13 }}>
                              {proposal.title}
                            </Typography>
                            <Typography
                              color="text.secondary"
                              sx={{ fontSize: 12, maxWidth: 420 }}
                            >
                              {proposal.summary}
                            </Typography>
                          </Stack>
                        </TableCell>
                        <TableCell
                          sx={{ fontFamily: "monospace", fontSize: 12 }}
                        >
                          {proposal.resourceKind} / {proposal.resourceId}
                        </TableCell>
                        <TableCell
                          sx={{ fontFamily: "monospace", fontSize: 12 }}
                        >
                          {proposal.action}
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={proposal.risk}
                            color={riskColor[proposal.risk]}
                            variant={
                              proposal.risk === "low" ? "outlined" : "filled"
                            }
                          />
                        </TableCell>
                        <TableCell sx={{ fontSize: 12 }}>
                          {proposal.reversible ? "yes" : "no"}
                        </TableCell>
                        <TableCell align="right">
                          <Button
                            size="small"
                            variant="outlined"
                            disabled={apply.isPending}
                            onClick={() =>
                              proposal.risk === "low"
                                ? applyProposal(proposal)
                                : setConfirmTarget(proposal)
                            }
                          >
                            Apply
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Paper>
            </>
          )}
          {!analyzed && (
            <Paper sx={{ p: 3 }}>
              <Typography sx={{ fontWeight: 650 }}>
                Ready when you are
              </Typography>
              <Typography
                color="text.secondary"
                sx={{ mt: 0.35, maxWidth: 700 }}
              >
                Run the analysis to inspect {host.displayName}. The rules check
                for failed or restarting containers, dangling images, unmounted
                local volumes, and unused networks.
              </Typography>
            </Paper>
          )}
        </Stack>
      )}
      <Dialog
        open={Boolean(confirmTarget)}
        onClose={() => setConfirmTarget(undefined)}
      >
        <DialogTitle>Apply proposed action</DialogTitle>
        <DialogContent dividers>
          <Typography>{confirmTarget?.title}</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.75, fontSize: 13 }}>
            {confirmTarget?.summary}
          </Typography>
          {confirmTarget && !confirmTarget.reversible && (
            <Alert severity="warning" sx={{ mt: 1.5 }}>
              This action is not reversible. Make sure the target is safe to
              change.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmTarget(undefined)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={apply.isPending}
            onClick={() => {
              const target = confirmTarget;
              if (!target) return;
              setConfirmTarget(undefined);
              applyProposal(target);
            }}
          >
            Apply
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
