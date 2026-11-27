/**
 * gt-campos.mjs — GT textual curado para la prueba S (Agente 2, plan V3 §1).
 *
 * Curación: valores ejemplo de las especificaciones (que coinciden con el banco
 * escaneado) + lectura visual de las imágenes (escaneados y fotos reales), 2026-11-27.
 * La luz del usuario no está disponible en este entorno: supuesto declarado en el informe.
 * El GT datalab-convert-*.json (Chandra) se usa como GT ESTRUCTURAL aparte; aquí
 * van los valores esperados por campo para la extracción M2 (sin molde).
 */

export const GT_CAMPOS = {
  '01-RECIBO-DE-PAGO/escaneado/pag-01': {
    variante: 'REC 1 — completo · firmado (banco escaneado)',
    titulo: 'RECIBO DE PAGO',
    numero_recibo: 'REC-2026-0314',
    fecha_emision: '03 de diciembre de 2026',
    emisor_nombre: 'Fernando Cabrera Leal',
    emisor_dni: '45.876.213',
    emisor_cargo: 'Gerente financiero',
    emisor_empresa: 'Logística Ibérica S.L.',
    emisor_cif: 'B-78123456',
    pagador_nombre: 'Carmen Ordóñez Vidal',
    pagador_dni: '52.340.987',
    pagador_cargo: 'Directora administrativa',
    pagador_empresa: 'Materiales Andaluces S.A.',
    pagador_cif: 'A-60987412',
    importe: '2.480,50 €',
    importe_letras: 'dos mil cuatrocientos ochenta euros con cincuenta céntimos',
    concepto: 'Pago del 50 % de la factura F-2026-092, por servicio de transporte de mercancía.',
    forma_pago: 'Transferencia bancaria',
    iban: 'ES76 2077 0024 0031 0442 9015',
    fecha_pago: '05/12/2026',
  },
  '01-RECIBO-DE-PAGO/real/recibo-a-impreso-firmas-vacias-01': {
    variante: 'REC A — datos impresos · firmas vacías (foto real, ≡ GT datalab p0)',
    titulo: 'RECIBO DE PAGO',
    numero_recibo: 'REC-2026-0157',
    fecha_emision: '02 de febrero de 2026',
    emisor_nombre: 'Lucía Torres Medina',
    emisor_dni: '48.221.907',
    emisor_cargo: 'Administradora',
    emisor_empresa: 'Suministros Delta S.L.',
    emisor_cif: 'B-87654321',
    pagador_nombre: 'Andrés Molina Castaño',
    pagador_dni: '79.554.312',
    pagador_cargo: 'Representante legal',
    pagador_empresa: 'Construcciones Roble Ltda.',
    pagador_cif: 'B-12345678',
    importe: '1.250,00 €',
    importe_letras: 'mil doscientos cincuenta euros',
    concepto: 'Anticipo del 30 % por suministro de material de obra, según pedido P-2026-118.',
    forma_pago: 'Transferencia bancaria',
    iban: 'ES91 2100 0418 4502 0005 1332',
    fecha_pago: '05/02/2026',
  },
  '02-RECIBO-DE-ENTREGA/escaneado/pag-01': {
    variante: 'VAR 1 — completo · firmado (banco escaneado)',
    titulo: 'COMPROBANTE DE ENTREGA DEL PRODUCTO',
    nombre_comprador: 'Valentina Rodríguez Salazar',
    documento_comprador: 'CC 1.098.234.567',
    telefono: '310 555 0142',
    calle: 'Calle 72 # 10-34',
    nro: '10-34',
    piso: '5',
    dpto: '501',
    articulo: 'Lavadora secadora 20 kg, modelo LS-2000',
    numero_operacion: 'OP-2026-005847',
    descripcion: 'Electrodoméstico nuevo, con garantía de 24 meses. Entrega a domicilio con instalación básica incluida y verificación de identidad del comprador.',
    fecha_entrega: '18 de noviembre de 2026',
  },
  '02-RECIBO-DE-ENTREGA/real/comprobante-a-impreso-firmas-vacias-01': {
    variante: 'VAR A — datos impresos · firmas vacías (foto real)',
    titulo: 'COMPROBANTE DE ENTREGA DEL PRODUCTO',
    nombre_comprador: 'María Fernanda López Gómez',
    documento_comprador: 'CC 1.023.456.789',
    telefono: '310 555 0198',
    calle: 'Calle 45 # 12-34',
    nro: '12-34',
    piso: '3',
    dpto: '302',
    articulo: 'Nevera no frost 320 L, modelo XS-320',
    numero_operacion: 'OP-2026-004512',
    descripcion: 'Electrodoméstico nuevo en caja, con garantía de 12 meses. Entrega a domicilio con verificación de identidad del comprador.',
    fecha_entrega: null,
  },
};

/**
 * Anclas de identificación por tipo de documento (especificaciones §1): el
 * clasificador M2-estructural debe hallar ≥2 para clasificar sin molde.
 */
export const ANCLAS = {
  recibo: ['N.º Recibo:', 'Recibí de:', 'La suma de:', 'En concepto de:', 'Forma de pago:'],
  comprobante: ['Nombre y apellido:', 'Número de Documento:', 'Teléfono:', 'Dirección de entrega', 'Artículo:', 'Fecha de entrega'],
};
