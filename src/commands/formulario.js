// Sistema de formulário: /formulario → painel com botões → modais em 2 etapas
const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
} = require('discord.js');

const CHANNEL_ID = process.env.FORM_CHANNEL_ID; // opcional: canal que recebe as respostas

function buildFormMessage() {
  const embed = new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle('📋 Sistema de Formulário')
    .setDescription(
      'Clique no botão abaixo para abrir o formulário.\n\n' +
        'O formulário possui 2 etapas:\n' +
        '1️⃣ Nome e Idade\n' +
        '2️⃣ Motivo / Relato\n' +
        'Suas respostas serão registradas pela staff.'
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('form_start').setLabel('Abrir Formulário').setStyle(ButtonStyle.Primary).setEmoji('📝'),
    new ButtonBuilder().setCustomId('form_cancel').setLabel('Cancelar').setStyle(ButtonStyle.Secondary).setEmoji('✖️')
  );

  return { embeds: [embed], components: [row] };
}

async function execute(interaction) {
  await interaction.channel.send(buildFormMessage());
  await interaction.reply({ content: '✅ Painel do formulário enviado neste canal!', ephemeral: true });
}

// ---------- Handlers de botões ----------
async function handleComponent(interaction) {
  const id = interaction.customId;

  if (id === 'form_cancel' || id === 'form_cancel_2') {
    return interaction.update({ content: '❌ Formulário cancelado.', embeds: [], components: [] });
  }

  if (id === 'form_start') {
    const modal = new ModalBuilder().setCustomId('form_modal_1').setTitle('Formulário — Etapa 1');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('nome').setLabel('Seu nome').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('idade').setLabel('Sua idade').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3)
      )
    );
    return interaction.showModal(modal);
  }

  if (id === 'form_next') {
    const modal = new ModalBuilder().setCustomId('form_modal_2').setTitle('Formulário — Etapa 2');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('motivo')
          .setLabel('Motivo / Relato')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
      )
    );
    return interaction.showModal(modal);
  }
}

// ---------- Handlers de modais ----------
async function handleModal(interaction) {
  const fields = Object.fromEntries(interaction.fields.map((f) => [f.customId, f.value]));

  if (interaction.customId === 'form_modal_1') {
    const { nome, idade } = fields;

    if (!/^\d{1,3}$/.test(idade) || +idade < 1 || +idade > 150) {
      return interaction.reply({ content: '❌ Idade inválida. Abra o formulário novamente.', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setColor('#57F287')
      .setTitle('✅ Etapa 1 concluída')
      .setDescription(`**Nome:** ${nome}\n**Idade:** ${idade}\n\nClique em **Continuar** para a etapa 2.`);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('form_next').setLabel('Continuar').setStyle(ButtonStyle.Success).setEmoji('➡️'),
      new ButtonBuilder().setCustomId('form_cancel_2').setLabel('Cancelar').setStyle(ButtonStyle.Secondary).setEmoji('✖️')
    );

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });

    interaction.client.formData = interaction.client.formData || {};
    interaction.client.formData[interaction.user.id] = { nome, idade };
    return;
  }

  if (interaction.customId === 'form_modal_2') {
    const data = interaction.client.formData?.[interaction.user.id] || {};
    delete interaction.client.formData?.[interaction.user.id];

    const embed = new EmbedBuilder()
      .setColor('#FEE75C')
      .setTitle('📨 Nova resposta de formulário')
      .addFields(
        { name: 'Usuário', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Nome', value: data.nome || '—', inline: true },
        { name: 'Idade', value: String(data.idade || '—'), inline: true },
        { name: 'Motivo / Relato', value: fields.motivo }
      )
      .setTimestamp();

    const target = (CHANNEL_ID && interaction.client.channels.cache.get(CHANNEL_ID)) || interaction.channel;
    await target.send({ embeds: [embed] });

    return interaction.reply({ content: '✅ Formulário enviado com sucesso! Obrigado.', ephemeral: true });
  }
}

module.exports = { data: new SlashCommandBuilder().setName('formulario').setDescription('Envia o painel do sistema de formulário com botões'), execute, handleComponent, handleModal, buildFormMessage };
