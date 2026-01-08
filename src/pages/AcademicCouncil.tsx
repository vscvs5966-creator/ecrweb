import { useCallback, useEffect, useRef, useState } from 'react';
import Layout from '@/components/layout/Layout';
import { Award, BookOpen, FileDown, GraduationCap, Presentation } from 'lucide-react';
import { academicCouncilAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { loadJsPdf, loadPptxGen, loadToPng } from '@/lib/export-utils';

type CouncilMember = {
  id: number;
  name: string;
  designation?: string;
  qualifications?: string;
  expertise?: string;
  department?: string;
  image?: string | null;
};

const API_BASE = import.meta.env.VITE_API_BASE || '/api';
const MEDIA_BASE = import.meta.env.VITE_MEDIA_BASE || '/media';

const resolveMemberImage = (member: any) => {
  if (member?.image_url) {
    return member.image_url;
  }

  if (member?.image) {
    const sanitized = String(member.image).replace(/^\/+/, '');
    return `${MEDIA_BASE}/${sanitized}`;
  }

  return null;
};

const AcademicCouncil = () => {
  const [members, setMembers] = useState<CouncilMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [debugImage, setDebugImage] = useState<string | null>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  const hasMembers = members.length > 0;

  const waitForExportMedia = useCallback(async () => {
    if (!exportRef.current) return;
    const images = Array.from(exportRef.current.querySelectorAll('img'));

    await Promise.all(
      images.map((img) => {
        if (img.complete && img.naturalWidth > 0) {
          return Promise.resolve();
        }

        return new Promise<void>((resolve) => {
          const handleComplete = () => resolve();
          img.addEventListener('load', handleComplete, { once: true });
          img.addEventListener('error', handleComplete, { once: true });
        });
      })
    );
  }, []);

  const generateImage = useCallback(async () => {
    const toPng = await loadToPng();
    const node = exportRef.current;
    if (!node) {
      throw new Error('Nothing to export yet.');
    }

    await waitForExportMedia();

    // Temporarily make sure the export node is visible for accurate layout measurement
    const previousVisibility = node.style.visibility;
    const previousOpacity = node.style.opacity;
    node.style.visibility = 'visible';
    node.style.opacity = '1';

    try {
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        console.warn('Academic Council pamphlet export target has zero size', {
          width: rect.width,
          height: rect.height,
          offsetWidth: node.offsetWidth,
          offsetHeight: node.offsetHeight,
        });
        throw new Error('Pamphlet export target is empty.');
      }

      const computed = typeof window !== 'undefined' ? window.getComputedStyle(node) : null;
      const backgroundColor = computed?.backgroundColor ?? '#020617';

      const dataUrl = await toPng(node, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor,
        useCORS: true,
      });

      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png')) {
        console.warn('Academic Council pamphlet export produced unexpected data URL', { length: (dataUrl as any)?.length });
        throw new Error('Unable to render pamphlet image.');
      }

      console.info('Academic Council pamphlet PNG generated', {
        length: dataUrl.length,
        width: rect.width,
        height: rect.height,
      });
      console.log('Pamphlet data URL prefix:', dataUrl.slice(0, 64));

      if (typeof window !== 'undefined') {
        (window as any).__academicCouncilPamphletImage = dataUrl;
        (window as any).__academicCouncilPamphletMeta = {
          width: rect.width,
          height: rect.height,
          length: dataUrl.length,
        };
      }

      if (import.meta.env.DEV) {
        setDebugImage(dataUrl);
      }

      return dataUrl;
    } finally {
      node.style.visibility = previousVisibility;
      node.style.opacity = previousOpacity;
    }
  }, [waitForExportMedia]);

  const handleExportPdf = useCallback(async () => {
    if (!hasMembers) return;

    try {
      console.info('Starting Academic Council PDF export');
      setIsExporting(true);
      const dataUrl = await generateImage();
      const JsPdf = await loadJsPdf();
      const pdf = new JsPdf('landscape', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      pdf.addImage(dataUrl, 'PNG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
      pdf.save('academic-council-pamphlet.pdf');
    } catch (error) {
      console.error('Unable to export academic council pamphlet', error);
      window.alert('Unable to export academic council pamphlet right now. Please try again.');
    } finally {
      setIsExporting(false);
    }
  }, [generateImage, hasMembers]);

  const handleExportPpt = useCallback(async () => {
    if (!hasMembers) return;

    try {
      console.info('Starting Academic Council PPT export');
      setIsExporting(true);
      const dataUrl = await generateImage();
      const PptxGen = await loadPptxGen();
      const pptx = new PptxGen();
      const slide = pptx.addSlide();

      const slideWidth = pptx.layout?.width ?? 13.33;
      const slideHeight = pptx.layout?.height ?? 7.5;

      slide.addImage({
        data: dataUrl,
        x: 0,
        y: 0,
        w: slideWidth,
        h: slideHeight,
      });

      await pptx.writeFile('academic-council-pamphlet.pptx');
    } catch (error) {
      console.error('Unable to export academic council pamphlet to PPT', error);
      window.alert('Unable to export academic council pamphlet right now. Please try again.');
    } finally {
      setIsExporting(false);
    }
  }, [generateImage, hasMembers]);

  useEffect(() => {
    let isMounted = true;
    const loadMembers = async () => {
      try {
        setLoading(true);
        const data = await academicCouncilAPI.getPublicList();
        if (!isMounted) return;
        const mapped: CouncilMember[] = (data || []).map((m: any) => ({
          id: m.id,
          name: m.name ?? '',
          designation: m.designation ?? m.position ?? undefined,
          qualifications: m.qualifications ?? undefined,
          expertise: m.bio ?? undefined,
          department: m.department ?? undefined,
          image: resolveMemberImage(m),
        }));
        setMembers(mapped);
        setError(null);
      } catch (err) {
        console.error('Failed to load academic council', err);
        if (!isMounted) return;
        setError('Unable to load academic council at the moment.');
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadMembers();
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <>
      <Layout>
        {/* Hero Section */}
        <section className="ecr-section bg-hero-pattern">
          <div className="ecr-container">
            <div className="max-w-4xl mx-auto text-center">
              <span className="text-primary font-semibold text-sm tracking-wider uppercase mb-4 block">
                Academic Excellence
              </span>
              <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold text-foreground mb-6">
                Academic Council
              </h1>
              <p className="text-muted-foreground text-lg md:text-xl">
                Our distinguished faculty and resource persons dedicated to academic excellence
              </p>
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="py-12 bg-card">
          <div className="ecr-container">
            <div className="grid grid-cols-3 gap-8">
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <GraduationCap className="w-8 h-8 text-primary" />
                </div>
                <div className="font-display text-3xl font-bold text-foreground">150+</div>
                <p className="text-muted-foreground">Faculty Members</p>
              </div>
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <Award className="w-8 h-8 text-primary" />
                </div>
                <div className="font-display text-3xl font-bold text-foreground">50+</div>
                <p className="text-muted-foreground">PhD Holders</p>
              </div>
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <BookOpen className="w-8 h-8 text-primary" />
                </div>
                <div className="font-display text-3xl font-bold text-foreground">20+</div>
                <p className="text-muted-foreground">Departments</p>
              </div>
            </div>
          </div>
        </section>

        {/* Council Members Grid */}
        <section className="ecr-section bg-background">
          <div className="ecr-container">
            <div className="flex flex-col gap-8">
              <div className="flex flex-col items-center gap-4 md:flex-row md:items-center md:justify-between">
                <div className="text-center md:text-left">
                  <h2 className="font-display text-3xl font-bold text-foreground mb-3">
                    Key Resource Persons
                  </h2>
                  <p className="text-muted-foreground max-w-3xl">
                    Meet the accomplished educators and industry experts guiding our academic excellence.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-3 md:justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportPdf}
                    disabled={isExporting || !hasMembers}
                  >
                    <FileDown className="mr-2 h-4 w-4" />
                    Download PDF
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportPpt}
                    disabled={isExporting || !hasMembers}
                  >
                    <Presentation className="mr-2 h-4 w-4" />
                    Download PPT
                  </Button>
                </div>
              </div>

              {loading ? (
                <p className="text-center text-muted-foreground">Loading council members...</p>
              ) : error ? (
                <p className="text-center text-red-500">{error}</p>
              ) : members.length === 0 ? (
                <p className="text-center text-muted-foreground">Council members will be announced soon.</p>
              ) : (
                <>
                  <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {members.map((member) => (
                      <div key={member.id} className="ecr-card text-center group">
                        <div className="w-24 h-24 mx-auto mb-4 rounded-full bg-gradient-to-br from-secondary to-muted flex items-center justify-center overflow-hidden group-hover:from-primary group-hover:to-gold-dark transition-all">
                          {member.image ? (
                            <img
                              src={member.image}
                              alt={member.name}
                              crossOrigin="anonymous"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <span className="font-display text-2xl font-bold text-foreground group-hover:text-primary-foreground transition-colors">
                              {member.name.charAt(0)}
                            </span>
                          )}
                        </div>

                        <h3 className="font-display text-lg font-semibold text-foreground mb-1">{member.name}</h3>
                        {member.designation && (
                          <p className="text-primary font-medium text-sm mb-1">{member.designation}</p>
                        )}
                        {member.qualifications && (
                          <p className="text-xs text-muted-foreground mb-2">{member.qualifications}</p>
                        )}
                        {member.expertise && (
                          <p className="text-sm text-muted-foreground italic">{member.expertise}</p>
                        )}
                      </div>
                    ))}
                  </div>

                  {import.meta.env.DEV && debugImage && (
                    <div className="mt-12 rounded-lg border border-dashed border-primary/40 bg-muted/30 p-6">
                      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        Debug Preview (Development Only)
                      </h3>
                      <div className="overflow-auto rounded-xl border border-border bg-background p-4">
                        <img src={debugImage} alt="Academic Council pamphlet preview" className="max-h-[480px] w-full object-contain" />
                      </div>
                      <p className="mt-3 text-xs text-muted-foreground">
                        This live preview is only visible in development mode to verify the exported pamphlet image.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </section>
      </Layout>

      {hasMembers && (
        <div
          ref={exportRef}
          aria-hidden="true"
          className="pointer-events-none absolute -left-[16000px] top-0 w-[1600px] bg-white px-16 py-20 text-slate-900 opacity-0"
        >
          <div className="space-y-10">
            <div className="text-center space-y-3">
              <h1 className="font-display text-5xl font-bold text-slate-900">Key Resource Persons</h1>
              <p className="mx-auto max-w-4xl text-lg text-slate-600">
                Meet the accomplished educators and industry experts guiding our academic excellence.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-10">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="flex flex-col items-center gap-4 rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl shadow-slate-200/60"
                >
                  <div className="h-28 w-28 overflow-hidden rounded-full border-4 border-primary/30 bg-gradient-to-br from-slate-100 to-slate-200">
                    {member.image ? (
                      <img
                        src={member.image}
                        alt={member.name}
                        crossOrigin="anonymous"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center font-display text-3xl font-semibold text-primary">
                        {member.name.charAt(0)}
                      </span>
                    )}
                  </div>
                  <div className="space-y-2">
                    <h3 className="font-display text-2xl font-semibold text-slate-900">{member.name}</h3>
                    {member.designation && (
                      <p className="text-base font-medium text-primary">{member.designation}</p>
                    )}
                    {member.qualifications && (
                      <p className="text-sm text-slate-600">{member.qualifications}</p>
                    )}
                    {member.expertise && (
                      <p className="text-sm text-slate-500 italic">{member.expertise}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default AcademicCouncil;
