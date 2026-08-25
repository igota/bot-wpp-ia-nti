# Base de Conhecimento — Núcleo de Tecnologia da Informação (NTI)

## 1. Atendimento do NTI

### Horário de atendimento
- **Segunda a sexta-feira:** 07h às 17h.
- **Ramal do NTI:** 9385.
- Fora do horário de expediente, quando indicado neste documento, o funcionário deve entrar em contato com o **NAC**.

---

## 2. Reset de senha do e-mail institucional

### Regra
Se o funcionário precisar **resetar a senha do e-mail institucional**, deve entrar em contato diretamente com o NTI:

- **Ramal:** 9385
- **Atendimento presencial:** durante o expediente.
- **Horário:** segunda a sexta-feira, das 07h às 17h.

### Resposta do BOT
Orientar o funcionário a entrar em contato com o NTI pelo ramal 9385 ou presencialmente, durante o horário de expediente.

---

## 2.1 Usuário do computador / Windows

### Regra
O usuário e a senha de login do **computador/Windows** são as **MESMAS credenciais do GLPI** (é a mesma conta do Active Directory).

Isso vale também quando aparecer a mensagem de **"usuário bloqueado"** (ou similar) ao tentar fazer login no computador/Windows — o caso é tratado da mesma forma.

### Resposta do BOT
Informar que o login do computador/Windows usa as mesmas credenciais do GLPI, e orientar o funcionário a escolher a **opção 1 do Menu Principal** do BOT para resolver (resetar senha ou desbloquear o usuário).

---

## 3. Criação de novo e-mail institucional

### Regra
Para solicitar a **criação de um novo e-mail institucional**, o funcionário não deve solicitar diretamente ao NTI.

O **coordenador do setor** deve abrir um chamado no GLPI.

### GLPI
https://sistemasnti.isgh.org.br/glpi/

### Resposta do BOT
Orientar o funcionário a solicitar ao coordenador do setor que abra um chamado no GLPI para criação do novo e-mail institucional.

---

## 4. Voucher de Internet Wi-Fi — HRN WIFI

### 4.1 Solicitação de voucher

Se o funcionário estiver solicitando um **voucher de Internet/Wi-Fi**, deve solicitar ao **coordenador do setor**.

### Regra
Os vouchers são direcionados ao coordenador do setor.

### Resposta do BOT
Orientar o funcionário a procurar o coordenador do seu setor para solicitar o voucher.

---

## 5. Voucher expirando antes do tempo — HRN WIFI

Se o funcionário já possui um voucher, mas ele está **expirando antes do tempo esperado**, primeiro deve verificar a configuração do endereço MAC do dispositivo.

### Regra importante

Por padrão, os celulares utilizam um **MAC aleatório** ao se conectar às redes Wi-Fi, como forma de aumentar a privacidade.

Na rede **HRN WIFI**, é necessário utilizar um **MAC fixo**.

O funcionário deve alterar essa configuração **antes de digitar o voucher**.

---

### 5.1 iPhone (iOS)

1. Acesse **Ajustes**.
2. Toque em **Wi-Fi**.
3. Encontre a rede **HRN WIFI**.
4. Toque no ícone **ⓘ** ao lado da rede.
5. Procure a opção **Endereço Privado**.
6. Coloque a opção como **Desativado**.
7. O iPhone passará a utilizar um MAC fixo nessa rede.
8. Conecte-se novamente à rede.
9. Digite o voucher.

---

### 5.2 Android

O caminho pode variar conforme a marca e a versão do Android.

Processo geral:

1. Acesse **Configurações**.
2. Toque em **Wi-Fi**.
3. Selecione **HRN WIFI**.
4. Acesse **Configurações da rede** ou **Editar**.
5. Procure **Privacidade** ou **Tipo de endereço MAC**.
6. Selecione **Usar MAC do dispositivo**.
7. Salve as alterações.
8. Reconecte-se ao Wi-Fi.
9. Digite o voucher.

---

## 6. Computador sem rede

Se o computador estiver **sem acesso à rede**, o BOT deve orientar algumas verificações básicas antes de encaminhar para o NTI.

### Verificações básicas

1. Verifique se o cabo de rede está conectado corretamente ao computador.
2. Verifique se o cabo também está conectado corretamente ao ponto de rede.
3. Verifique se as luzes da porta de rede estão acesas ou piscando, quando disponíveis.
4. Reinicie o computador.
5. Verifique se outros computadores do mesmo setor também estão sem rede.
6. Se possível, teste o computador em outro ponto de rede conhecido como funcional.

### Se não resolver

Durante o expediente (segunda a sexta-feira, das 07h às 17h):

- Entrar em contato com o **NTI pelo ramal 9385**; ou
- Abrir chamado no **GLPI**: https://sistemasnti.isgh.org.br/glpi/
  - O chamado deve ser aberto com o **usuário individual** do funcionário (não com usuário de setor), para garantir a rastreabilidade.
  - Especificar o problema com o máximo de detalhes possível na abertura do chamado.
  - Se o funcionário **não tiver acesso ao GLPI**, orientar a escolher a **opção 1 do Menu Principal** do BOT para resolver o acesso (usuário do Windows/AD).

Fora do expediente:

- Entrar em contato com o **NAC**.

### Problema na tomada/ponto de energia

Se houver suspeita de problema na tomada, orientar o funcionário a:

1. Testar outra tomada.
2. Verificar se o equipamento funciona em outra tomada.
3. Se a tomada continuar sem funcionar, abrir um chamado para a **Manutenção através do sistema Neovero** (https://isgh.neovero.com/login).

---

## 7. Computador não liga

### Verificações básicas

O BOT pode orientar o funcionário a:

1. Verificar se o cabo de energia está conectado corretamente.
2. Verificar se a tomada está funcionando.
3. Testar outra tomada.
4. Verificar se há sinais de energia no equipamento.
5. Verificar se o filtro de linha, estabilizador ou nobreak está ligado, quando houver.
6. Tentar ligar o computador novamente.

### Se não resolver

Durante o expediente (segunda a sexta-feira, das 07h às 17h):

- Entrar em contato com o **NTI pelo ramal 9385**; ou
- Abrir chamado no **GLPI**: https://sistemasnti.isgh.org.br/glpi/
  - O chamado deve ser aberto com o **usuário individual** do funcionário (não com usuário de setor), para garantir a rastreabilidade.
  - Especificar o problema com o máximo de detalhes possível na abertura do chamado.
  - Se o funcionário **não tiver acesso ao GLPI**, orientar a escolher a **opção 1 do Menu Principal** do BOT para resolver o acesso (usuário do Windows/AD).

Fora do expediente:

- Entrar em contato com o **NAC**.

### Problema na tomada

Se a tomada não funcionar:

- Testar outra tomada.
- Se continuar sem funcionar, abrir chamado para a **Manutenção através do sistema Neovero** (https://isgh.neovero.com/login).

---

## 8. Impressora — mensagem "Toner não genuíno"

Quando a impressora apresentar a mensagem **"Toner não genuíno"**, orientar o funcionário a:

1. Pressionar simultaneamente o botão laranja **Cancelar** e o botão **OK**.
2. Manter os dois botões pressionados por **no mínimo 5 segundos**.
3. Após isso, verificar se a mensagem foi removida.

---

## 8.1 Impressora sem ligar ou sem rede

Se a impressora estiver **sem ligar** ou **sem acesso à rede**, o BOT deve orientar algumas verificações básicas antes de encaminhar para o NTI.

### Verificações básicas

1. Verificar se o cabo de energia da impressora está conectado corretamente.
2. Testar a tomada com outro equipamento, ou testar a impressora em outra tomada.
3. Verificar se o cabo de rede está conectado corretamente à impressora e ao ponto de rede (a rede do hospital é cabeada, não há Wi-Fi para PCs/impressoras).
4. Reiniciar a impressora (desligar, aguardar alguns segundos, ligar novamente).
5. Verificar se outros equipamentos do mesmo setor também estão sem rede.

### Se não resolver

Durante o expediente (segunda a sexta-feira, das 07h às 17h):

- Entrar em contato com o **NTI pelo ramal 9385**; ou
- Abrir chamado no **GLPI**: https://sistemasnti.isgh.org.br/glpi/
  - O chamado deve ser aberto com o **usuário individual** do funcionário (não com usuário de setor), para garantir a rastreabilidade.
  - Especificar o problema com o máximo de detalhes possível na abertura do chamado.
  - Se o funcionário **não tiver acesso ao GLPI**, orientar a escolher a **opção 1 do Menu Principal** do BOT para resolver o acesso (usuário do Windows/AD).

Fora do expediente:

- Entrar em contato com o **NAC**.

### Problema na tomada/ponto de energia

Se houver suspeita de problema na tomada, orientar o funcionário a:

1. Testar outra tomada.
2. Verificar se o equipamento funciona em outra tomada.
3. Se a tomada continuar sem funcionar, abrir um chamado para a **Manutenção através do sistema Neovero** (https://isgh.neovero.com/login).

---

## 8.2 Impressora de etiquetas

### Regra
Se o funcionário estiver com **dificuldade para manusear/utilizar a impressora de etiquetas**, ou tiver **qualquer outro problema** relacionado a ela, o BOT deve indicar o vídeo tutorial abaixo.

### Vídeo tutorial
https://drive.google.com/file/d/126GLePw948kViAEq7pe9soRlH3FmhnWZ/view?usp=sharing

### Resposta do BOT
Enviar o link do vídeo tutorial acima, informando que ele ensina a utilizar a impressora de etiquetas.

### Se não resolver

Durante o expediente (segunda a sexta-feira, das 07h às 17h):

- Entrar em contato com o **NTI pelo ramal 9385**; ou
- Abrir chamado no **GLPI**: https://sistemasnti.isgh.org.br/glpi/
  - O chamado deve ser aberto com o **usuário individual** do funcionário (não com usuário de setor), para garantir a rastreabilidade.
  - Especificar o problema com o máximo de detalhes possível na abertura do chamado.
  - Se o funcionário **não tiver acesso ao GLPI**, orientar a escolher a **opção 1 do Menu Principal** do BOT para resolver o acesso (usuário do Windows/AD).

Fora do expediente:

- Entrar em contato com o **NAC**.

---

## 9. Acesso a portas com leitor de crachá

Se o funcionário não estiver conseguindo acessar alguma porta utilizando o **crachá**, deve solicitar à **coordenação do setor** que atualize a planilha de acesso.

### Informações necessárias

A coordenação deve verificar e atualizar na planilha as informações do funcionário necessárias para o acesso.

### Resposta do BOT
Orientar o funcionário a procurar a coordenação do seu setor e solicitar a atualização da planilha de acesso.

---

## 10. Transferência de hospital

Se o funcionário estiver solicitando ou tratando de uma **transferência de hospital**, deve entrar em contato com o **NAC**.

### Resposta do BOT
Orientar o funcionário a entrar em contato diretamente com o NAC.

---

## 11. Aplicativo CONECTA (Beehome)

### Regra
Se o funcionário perguntar sobre o **aplicativo CONECTA** (também conhecido como **Beehome**, nome do app na loja), o BOT deve orientar:

1. Baixar o aplicativo na **Play Store** (Android) ou na **App Store** (iPhone/iOS).
2. Na tela inicial do aplicativo, informar o endereço de acesso: **isghconecta**
3. Depois disso, o app vai para a tela de **CPF e Senha**.
4. Se o funcionário não souber o CPF/senha de acesso, orientar a escolher a **opção 2 do Menu Principal** do BOT (CONECTA - Alterar Senha).

### Resposta do BOT
Orientar a baixar o app CONECTA (Beehome) na Play Store ou App Store, informar o endereço de acesso "isghconecta" na tela inicial, e depois entrar com CPF e senha — ou escolher a opção 2 do Menu Principal caso não saiba a senha.

---

## 12. Sistema Notifica

### Regra
Se o funcionário perguntar ou tiver algum problema relacionado ao **sistema Notifica**, deve abrir um chamado no **GLPI**, com o **usuário individual** (não de setor), para garantir a rastreabilidade.

### GLPI
https://sistemasnti.isgh.org.br/glpi/

### Resposta do BOT
Orientar o funcionário a abrir um chamado no GLPI (https://sistemasnti.isgh.org.br/glpi/) usando seu usuário individual, especificando o problema.

---

## 13. Sistema Meu RH

### Regra
Se o funcionário perguntar ou tiver algum problema relacionado ao sistema **Meu RH**, deve entrar em contato diretamente com o **próprio setor do RH** — não é uma solicitação tratada pelo NTI.

### Resposta do BOT
Orientar o funcionário a entrar em contato com o setor de RH da empresa.

---

# Regras gerais para o BOT

## Quando encaminhar para o NTI

O BOT deve orientar o contato com o NTI quando:

- O problema estiver relacionado aos serviços de responsabilidade do NTI e as orientações deste documento não resolverem a situação.
- O funcionário precisar de atendimento técnico que não possa ser realizado pelas orientações disponíveis.

### Contato
- **NTI:** ramal 9385
- **Horário:** segunda a sexta-feira, das 07h às 17h.

## Quando encaminhar para o NAC

O BOT deve orientar o contato com o NAC quando este documento determinar especificamente o encaminhamento ao NAC, especialmente em situações fora do expediente do NTI relacionadas a computador sem rede ou computador que não liga.

## Quando encaminhar para a Manutenção

Quando houver problema identificado na **tomada** ou infraestrutura elétrica, o funcionário deve abrir chamado para a Manutenção através do **Neovero** (https://isgh.neovero.com/login).

## Regra de segurança da informação

O BOT deve responder com base nas regras e procedimentos oficiais desta base de conhecimento.

Se não houver informação suficiente para responder com segurança, o BOT **não deve inventar procedimentos**. Deve informar que não encontrou um procedimento específico e orientar o funcionário a procurar o setor responsável.
