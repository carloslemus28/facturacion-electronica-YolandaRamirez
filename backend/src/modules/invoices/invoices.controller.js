const emailsService = require('../emails/emails.service');
const dteJsonService = require('../dte/dte-json.service');
const dtePdfService = require('../dte/dte-pdf.service');
const invoicesService = require('./invoices.service');
const { createZipStreamWriter } = require('../../utils/zip-stream');

const getAutomaticEmailRecipients = (invoice) => {
  return [...new Set([
    invoice.customer?.email,
    invoice.customer?.secondaryEmail
  ]
    .map((email) => String(email || '').trim())
    .filter(Boolean))];
};

const sanitizeFileName = (value) => {
  return String(value || 'documento')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '_');
};

const isAdminUser = (user) => {
  return Array.isArray(user?.roles) && user.roles.includes('ADMIN');
};

const buildExportZipFileName = ({ startDate, endDate }) => {
  const today = new Date().toISOString().slice(0, 10);
  const range = startDate || endDate
    ? `${startDate || 'inicio'}_${endDate || 'fin'}`
    : today;

  return sanitizeFileName(`dte-json-pdf-${range}.zip`);
};

const exportDteFilesZip = async (req, res, next) => {
  if (!isAdminUser(req.user)) {
    return res.status(403).json({
      ok: false,
      message: 'Solo el usuario administrador puede descargar todos los JSON y PDF'
    });
  }

  const startDate = req.query.startDate;
  const endDate = req.query.endDate;
  const batchSize = Math.min(
    Math.max(Number(process.env.DTE_EXPORT_BATCH_SIZE || 25), 1),
    100
  );

  try {
    const total = await invoicesService.countInvoicesForDteFilesExport({
      user: req.user,
      startDate,
      endDate
    });

    if (total === 0) {
      return res.status(404).json({
        ok: false,
        message: 'No hay DTE en el rango de fechas seleccionado'
      });
    }

    const fileName = buildExportZipFileName({ startDate, endDate });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'no-store');

    const zip = createZipStreamWriter(res);

    await zip.addFile(
      'LEAME.txt',
      [
        'Exportación de DTE generada desde el sistema de facturación electrónica.',
        `Fecha de generación: ${new Date().toISOString()}`,
        `Rango aplicado: ${startDate || 'mes actual'} al ${endDate || 'mes actual'}`,
        `Total de documentos incluidos: ${total}`,
        '',
        'Carpeta json/: archivos JSON de los DTE.',
        'Carpeta pdf/: representaciones gráficas PDF generadas desde los datos del sistema.',
        'Carpeta errores/: se crea solo si algún documento no pudo generarse.'
      ].join('\n')
    );

    for (let offset = 0; offset < total; offset += batchSize) {
      const invoices = await invoicesService.listInvoicesForDteFilesExport({
        user: req.user,
        startDate,
        endDate,
        limit: batchSize,
        offset
      });

      for (const invoice of invoices) {
        const baseName = sanitizeFileName(
          invoice.controlNumber || invoice.generationCode || `DTE-${invoice.id}`
        );

        try {
          const json = await dteJsonService.getDteJsonByInvoiceId({
            id: invoice.id,
            user: req.user,
            type: 'document'
          });

          await zip.addFile(
            `json/${baseName}.json`,
            `${JSON.stringify(json, null, 2)}\n`,
            invoice.issuedAt
          );
        } catch (jsonError) {
          await zip.addFile(
            `errores/${baseName}-json.txt`,
            `No se pudo generar el JSON del DTE ${invoice.id}: ${jsonError.message}\n`,
            invoice.issuedAt
          );
        }

        try {
          const pdf = await dtePdfService.getDtePdfByInvoiceId({
            id: invoice.id,
            user: req.user,
            type: 'document'
          });

          await zip.addFile(
            `pdf/${sanitizeFileName(pdf.fileName || `${baseName}.pdf`)}`,
            pdf.buffer,
            invoice.issuedAt
          );
        } catch (pdfError) {
          await zip.addFile(
            `errores/${baseName}-pdf.txt`,
            `No se pudo generar el PDF del DTE ${invoice.id}: ${pdfError.message}\n`,
            invoice.issuedAt
          );
        }
      }
    }

    await zip.finalize();
  } catch (error) {
    if (res.headersSent) {
      console.error('Error exportando ZIP de DTE:', error);
      return res.end();
    }

    return next(error);
  }
};
const createGeneratedInvoice = async (req, res, next) => {
  try {
    const invoice = await invoicesService.createGeneratedInvoice({
      data: req.body,
      user: req.user
    });

    res.status(201).json({
      ok: true,
      message: 'DTE generado correctamente',
      invoice
    });
  } catch (error) {
    next(error);
  }
};

const updateGeneratedInvoice = async (req, res, next) => {
  try {
    const invoice = await invoicesService.updateGeneratedInvoice({
      id: req.params.id,
      data: req.body,
      user: req.user
    });

    res.status(200).json({
      ok: true,
      message: 'DTE actualizado correctamente',
      invoice
    });
  } catch (error) {
    next(error);
  }
};

const listInvoices = async (req, res, next) => {
  try {
    const invoices = await invoicesService.listInvoices({
      user: req.user,
      startDate: req.query.startDate,
      endDate: req.query.endDate
    });

    res.set('Cache-Control', 'no-store');

    res.status(200).json({
      ok: true,
      invoices
    });
  } catch (error) {
    next(error);
  }
};

const getInvoiceById = async (req, res, next) => {
  try {
    const invoice = await invoicesService.getInvoiceById(req.params.id, {
      user: req.user
    });

    res.status(200).json({
      ok: true,
      invoice
    });
  } catch (error) {
    next(error);
  }
};

const getDashboardSummary = async (req, res, next) => {
  try {
    const summary = await invoicesService.getDashboardSummary({
      user: req.user
    });

    res.set('Cache-Control', 'no-store');

    res.status(200).json({
      ok: true,
      summary
    });
  } catch (error) {
    next(error);
  }
};

const listAvailableDocumentsForCreditNote = async (req, res, next) => {
  try {
    const invoices = await invoicesService.listAvailableDocumentsForCreditNote({
      user: req.user
    });

    res.set('Cache-Control', 'no-store');

    res.status(200).json({
      ok: true,
      invoices
    });
  } catch (error) {
    next(error);
  }
};

const transmitReal = async (req, res, next) => {
  try {
    const invoice = await invoicesService.transmitInvoiceToHaciendaReal({
      id: req.params.id,
      user: req.user
    });

    let automaticEmail = {
      sent: false,
      skipped: false,
      message: null
    };

    const recipients = getAutomaticEmailRecipients(invoice);

    if (recipients.length === 0) {
      automaticEmail = {
        sent: false,
        skipped: true,
        message: 'El cliente no tiene correo registrado para el envío automático.'
      };
    } else {
      try {
        const email = await emailsService.sendInvoiceEmail({
          id: invoice.id,
          user: req.user,
          to: recipients
        });

        automaticEmail = {
          sent: true,
          skipped: false,
          recipient: email.recipient
        };
      } catch (emailError) {
        /*
          Hacienda ya aceptó el DTE. Un fallo SMTP no debe convertir
          la transmisión fiscal en error ni revertir el documento.
        */
        console.error(
          `⚠️ DTE ${invoice.id} aceptado por Hacienda, pero no se pudo enviar el correo automático: ${emailError.message}`
        );

        automaticEmail = {
          sent: false,
          skipped: false,
          recipient: recipients.join(', '),
          message: emailError.message
        };
      }
    }

    res.json({
      ok: true,
      message: 'DTE transmitido correctamente a Hacienda',
      invoice,
      automaticEmail
    });
  } catch (error) {
    next(error);
  }
};

const invalidateReal = async (req, res, next) => {
  try {
    const invoice = await invoicesService.invalidateInvoiceReal({
      id: req.params.id,
      user: req.user,
      reason: req.body.reason
    });

    let automaticEmail = {
      sent: false,
      skipped: false,
      message: null
    };

    const recipients = getAutomaticEmailRecipients(invoice);

    if (recipients.length === 0) {
      automaticEmail = {
        sent: false,
        skipped: true,
        message: 'El cliente no tiene correo registrado para el envío automático.'
      };
    } else {
      try {
        const email = await emailsService.sendInvoiceEmail({
          id: invoice.id,
          user: req.user,
          to: recipients
        });

        automaticEmail = {
          sent: true,
          skipped: false,
          recipient: email.recipient
        };
      } catch (emailError) {
        /*
          Hacienda ya aceptó la anulación. Un fallo SMTP no debe convertir
          la anulación fiscal en error ni revertir el documento.
        */
        console.error(
          `⚠️ DTE ${invoice.id} anulado ante Hacienda, pero no se pudo enviar el correo automático: ${emailError.message}`
        );

        automaticEmail = {
          sent: false,
          skipped: false,
          recipient: recipients.join(', '),
          message: emailError.message
        };
      }
    }

    res.json({
      ok: true,
      message: 'DTE anulado correctamente ante Hacienda',
      invoice,
      automaticEmail
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createGeneratedInvoice,
  updateGeneratedInvoice,
  listInvoices,
  getInvoiceById,
  getDashboardSummary,
  exportDteFilesZip,
  listAvailableDocumentsForCreditNote,
  transmitReal,
  invalidateReal
};