import { ChangeEvent, useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { companiesApi } from "../api/companies";
import { assetsApi } from "../api/assets";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";
import { CompanyPatternIcon } from "../components/CompanyPatternIcon";
import { Field } from "../components/agent-config-primitives";

export function CompanySettings() {
  const { selectedCompany, selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();

  const [companyName, setCompanyName] = useState("");
  const [brandColor, setBrandColor] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [logoUploadError, setLogoUploadError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedCompany) return;
    setCompanyName(selectedCompany.name);
    setBrandColor(selectedCompany.brandColor ?? "");
    setLogoUrl(selectedCompany.logoUrl ?? "");
  }, [selectedCompany]);

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Company", href: "/dashboard" },
      { label: "Settings" }
    ]);
  }, [setBreadcrumbs, selectedCompany?.name]);

  const dirty =
    !!selectedCompany &&
    (companyName !== selectedCompany.name ||
      brandColor !== (selectedCompany.brandColor ?? ""));

  const saveMutation = useMutation({
    mutationFn: () =>
      companiesApi.update(selectedCompanyId!, {
        name: companyName.trim(),
        brandColor: brandColor || null
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      pushToast({ title: "Settings saved", tone: "success" });
    },
    onError: (err) => {
      pushToast({
        title: "Failed to save",
        body: err instanceof Error ? err.message : "Unknown error",
        tone: "error"
      });
    }
  });

  const logoUploadMutation = useMutation({
    mutationFn: (file: File) =>
      assetsApi
        .uploadCompanyLogo(selectedCompanyId!, file)
        .then((asset) =>
          companiesApi.update(selectedCompanyId!, { logoAssetId: asset.assetId })
        ),
    onSuccess: (company) => {
      setLogoUrl(company.logoUrl ?? "");
      setLogoUploadError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    },
    onError: (err) => {
      setLogoUploadError(err instanceof Error ? err.message : "Logo upload failed");
    }
  });

  const clearLogoMutation = useMutation({
    mutationFn: () =>
      companiesApi.update(selectedCompanyId!, { logoAssetId: null }),
    onSuccess: (company) => {
      setLogoUrl(company.logoUrl ?? "");
      setLogoUploadError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    }
  });

  function handleLogoFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.currentTarget.value = "";
    if (!file) return;
    setLogoUploadError(null);
    logoUploadMutation.mutate(file);
  }

  if (!selectedCompany) {
    return (
      <div className="text-sm text-muted-foreground">
        No company selected. Select a company from the switcher above.
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-2">
        <Settings className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Settings</h1>
      </div>

      <div className="space-y-3 rounded-md border border-border px-4 py-4">
        <Field label="Company name" hint="The display name for your company.">
          <input
            className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
          />
        </Field>

        <div className="flex items-start gap-4 pt-1">
          <div className="shrink-0">
            <CompanyPatternIcon
              companyName={companyName || selectedCompany.name}
              logoUrl={logoUrl || null}
              brandColor={brandColor || null}
              className="rounded-[14px]"
            />
          </div>
          <div className="flex-1 space-y-3">
            <Field
              label="Logo"
              hint="Upload a PNG, JPEG, WEBP, GIF, or SVG logo image."
            >
              <div className="space-y-2">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                  onChange={handleLogoFileChange}
                  className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none file:mr-4 file:rounded-md file:border-0 file:bg-muted file:px-2.5 file:py-1 file:text-xs"
                />
                {logoUrl && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => clearLogoMutation.mutate()}
                    disabled={clearLogoMutation.isPending}
                  >
                    {clearLogoMutation.isPending ? "Removing..." : "Remove logo"}
                  </Button>
                )}
                {logoUploadMutation.isPending && (
                  <span className="text-xs text-muted-foreground">Uploading...</span>
                )}
                {(logoUploadError || clearLogoMutation.isError) && (
                  <span className="text-xs text-destructive">
                    {logoUploadError ??
                      (clearLogoMutation.error instanceof Error
                        ? clearLogoMutation.error.message
                        : "Failed")}
                  </span>
                )}
              </div>
            </Field>

            <Field
              label="Brand color"
              hint="Sets the hue for the company icon. Leave empty for auto-generated color."
            >
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={brandColor || "#6366f1"}
                  onChange={(e) => setBrandColor(e.target.value)}
                  className="h-8 w-8 cursor-pointer rounded border border-border bg-transparent p-0"
                />
                <input
                  type="text"
                  value={brandColor}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "" || /^#[0-9a-fA-F]{0,6}$/.test(v)) setBrandColor(v);
                  }}
                  placeholder="Auto"
                  className="w-28 rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm font-mono outline-none"
                />
                {brandColor && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setBrandColor("")}
                    className="text-xs text-muted-foreground"
                  >
                    Clear
                  </Button>
                )}
              </div>
            </Field>
          </div>
        </div>
      </div>

      {dirty && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !companyName.trim()}
          >
            {saveMutation.isPending ? "Saving..." : "Save changes"}
          </Button>
          {saveMutation.isError && (
            <span className="text-xs text-destructive">
              {saveMutation.error instanceof Error
                ? saveMutation.error.message
                : "Failed to save"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
